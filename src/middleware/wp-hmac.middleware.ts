/**
 * WordPress -> Railway HMAC authorization for the canonical user-mint pathway.
 *
 * FAIL CLOSED, unlike the legacy mint-gating middleware this supersedes for /api/mint:
 * a missing or short shared secret DISABLES the endpoint instead of waving requests
 * through. The browser never holds this secret - only the WordPress server signs.
 *
 * Signature scheme:
 *   x-vortex-timestamp: unix seconds, +/- 300s of server time
 *   x-vortex-signature: hex HMAC-SHA256( WP_RAILWAY_SHARED_SECRET, `${timestamp}.${rawBody}` )
 *
 * The timestamp inside the signed string makes every signature single-window; the replay
 * cache below refuses an identical signature inside that window, so a captured request
 * cannot be replayed at all.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const MAX_SKEW_SECONDS = 300;
const REPLAY_TTL_MS = (MAX_SKEW_SECONDS * 2 + 60) * 1000;
const REPLAY_MAX_ENTRIES = 10000;

// signature -> expiry epoch-ms. Bounded so a flood cannot grow it without limit.
const seenSignatures = new Map<string, number>();

function pruneReplayCache(now: number): void {
    if (seenSignatures.size < REPLAY_MAX_ENTRIES) {
        for (const [sig, exp] of seenSignatures) {
            if (exp <= now) { seenSignatures.delete(sig); }
        }
        return;
    }
    // Pathological flood: drop the oldest entries wholesale rather than OOM.
    const entries = [...seenSignatures.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < entries.length / 2; i++) { seenSignatures.delete(entries[i][0]); }
}

/** Exposed for tests: clear replay state between cases. */
export function _resetReplayCache(): void { seenSignatures.clear(); }

/**
 * Dashboard-pasted environment values very often carry a trailing space or newline that is
 * invisible in the UI. WordPress trims its side, so without trimming here an otherwise
 * correct secret produces an endless, unexplainable signature mismatch.
 */
function sharedSecret(): string {
    return (process.env.WP_RAILWAY_SHARED_SECRET || '').trim();
}

/**
 * One-time startup fingerprint. This is the first 16 hex characters of the SHA-256 of the
 * trimmed secret, which cannot be reversed into the secret, but can be compared against the
 * same fingerprint taken on the WordPress server to prove whether the two sides agree.
 */
(() => {
    const s = sharedSecret();
    if (!s) {
        logger.warn('[WP HMAC] no shared secret installed - the mint pathway is disabled');
        return;
    }
    const fp = crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
    logger.info(`[WP HMAC] shared secret loaded: length=${s.length} fingerprint=${fp}`);
})();

export function requireWpHmac(req: Request, res: Response, next: NextFunction) {
    const secret = sharedSecret();
    if (Buffer.byteLength(secret, 'utf8') < 32) {
        logger.error('[WP HMAC] WP_RAILWAY_SHARED_SECRET missing or shorter than 32 bytes - refusing (fail closed)');
        return res.status(503).json({
            success: false,
            code: 'MINT_AUTH_NOT_CONFIGURED',
            error: 'Mint authorization secret is not installed. The endpoint is disabled until it is.'
        });
    }

    const ts = String(req.headers['x-vortex-timestamp'] || '');
    const sig = String(req.headers['x-vortex-signature'] || '');
    if (!/^\d{10}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) {
        return res.status(401).json({ success: false, code: 'MINT_AUTH_MISSING', error: 'Missing or malformed authorization headers.' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - parseInt(ts, 10)) > MAX_SKEW_SECONDS) {
        return res.status(401).json({ success: false, code: 'MINT_AUTH_EXPIRED', error: 'Authorization timestamp outside the accepted window.' });
    }

    const raw = (req as any).rawBody !== undefined
        ? String((req as any).rawBody)
        : JSON.stringify(req.body ?? {});
    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');

    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        logger.warn('[WP HMAC] signature mismatch');
        return res.status(401).json({ success: false, code: 'MINT_AUTH_INVALID', error: 'Authorization signature does not match the request body.' });
    }

    const now = Date.now();
    pruneReplayCache(now);
    if (seenSignatures.has(sig)) {
        return res.status(401).json({ success: false, code: 'MINT_AUTH_REPLAYED', error: 'This authorization was already used.' });
    }
    seenSignatures.set(sig, now + REPLAY_TTL_MS);

    return next();
}
