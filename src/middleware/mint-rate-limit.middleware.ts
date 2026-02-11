/**
 * Mint-Specific Rate Limiter
 *
 * Dual-key rate limiting by wallet address AND IP.
 * In-memory Map with TTL (production-grade fallback).
 *
 * Env vars:
 *   MINT_RATE_LIMIT_WINDOW_SEC     (default 3600)
 *   MINT_RATE_LIMIT_MAX_PER_WALLET (default 3)
 *   MINT_RATE_LIMIT_MAX_PER_IP     (default 10)
 *
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const WINDOW_SEC = parseInt(process.env.MINT_RATE_LIMIT_WINDOW_SEC || '3600', 10);
const MAX_PER_WALLET = parseInt(process.env.MINT_RATE_LIMIT_MAX_PER_WALLET || '3', 10);
const MAX_PER_IP = parseInt(process.env.MINT_RATE_LIMIT_MAX_PER_IP || '10', 10);

interface BucketEntry {
    count: number;
    expiresAt: number;
}

const store = new Map<string, BucketEntry>();

// Cleanup stale entries every 60 s
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (entry.expiresAt <= now) store.delete(key);
    }
}, 60_000);

function increment(key: string): { count: number; ttlMs: number } {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.expiresAt <= now) {
        entry = { count: 0, expiresAt: now + WINDOW_SEC * 1000 };
    }
    entry.count++;
    store.set(key, entry);
    return { count: entry.count, ttlMs: Math.max(0, entry.expiresAt - now) };
}

function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getWallet(req: Request): string {
    return (
        req.body?.recipient_wallet ||
        req.body?.recipient ||
        req.body?.wallet_address ||
        'unknown'
    );
}

export function mintRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const wallet = getWallet(req);
    const ip = getClientIp(req);

    // Wallet limit
    if (wallet !== 'unknown') {
        const wb = increment(`mint:wallet:${wallet}`);
        if (wb.count > MAX_PER_WALLET) {
            const retryAfterSec = Math.ceil(wb.ttlMs / 1000);
            logger.warn('[Mint Rate Limit] Wallet limit hit', {
                event: 'rate_limit_hit', wallet, ip,
                retry_after_sec: retryAfterSec, key_type: 'wallet'
            });
            res.status(429).json({
                ok: false,
                code: 'RATE_LIMITED',
                message: 'Too many mint attempts. Please wait and try again later.',
                retry_after_sec: retryAfterSec
            });
            return;
        }
    }

    // IP limit
    const ib = increment(`mint:ip:${ip}`);
    if (ib.count > MAX_PER_IP) {
        const retryAfterSec = Math.ceil(ib.ttlMs / 1000);
        logger.warn('[Mint Rate Limit] IP limit hit', {
            event: 'rate_limit_hit', wallet, ip,
            retry_after_sec: retryAfterSec, key_type: 'ip'
        });
        res.status(429).json({
            ok: false,
            code: 'RATE_LIMITED',
            message: 'Too many mint attempts. Please wait and try again later.',
            retry_after_sec: retryAfterSec
        });
        return;
    }

    next();
}

logger.info('[Mint Rate Limit] Initialized', {
    window_sec: WINDOW_SEC,
    max_per_wallet: MAX_PER_WALLET,
    max_per_ip: MAX_PER_IP,
    store: 'in-memory'
});
