/**
 * Mint Gating Middleware
 *
 * Feature-gated access control for the mint endpoint.
 *
 * Env vars:
 *   MINT_GATING_MODE              OFF | ONBOARDING | TOLA_HOLD | TOLA_STAKE | ONBOARDING_OR_TOLA
 *   WP_RAILWAY_SHARED_SECRET      HMAC shared secret between WordPress and Railway
 *   MIN_TOLA_HOLD                 Minimum TOLA tokens required (default 25000)
 *   TOLA_MINT_ADDRESS             SPL mint address for TOLA token
 *   TOLA_STAKING_VAULT_ADDRESS    Vault address for staking (future)
 *
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import crypto from 'crypto';
import { logger } from '../utils/logger';

type GatingMode = 'OFF' | 'ONBOARDING' | 'TOLA_HOLD' | 'TOLA_STAKE' | 'ONBOARDING_OR_TOLA';

const MODE = (process.env.MINT_GATING_MODE || 'OFF').toUpperCase() as GatingMode;
const SHARED_SECRET = process.env.WP_RAILWAY_SHARED_SECRET || '';
const MIN_TOLA_HOLD = parseInt(process.env.MIN_TOLA_HOLD || '25000', 10);
const TOLA_MINT = process.env.TOLA_MINT_ADDRESS || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// -----------------------------------------------------------------------
// HMAC verification for WordPress server-to-server requests
// -----------------------------------------------------------------------

function verifyWpSignature(req: Request): boolean {
    if (!SHARED_SECRET) {
        logger.warn('[Mint Gating] WP_RAILWAY_SHARED_SECRET not set; skipping HMAC check');
        return true; // No secret configured = pass through
    }
    const sig = req.headers['x-vortex-signature'] as string;
    if (!sig) return false;
    try {
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const expected = crypto
            .createHmac('sha256', SHARED_SECRET)
            .update(body)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

// -----------------------------------------------------------------------
// On-chain TOLA balance check
// -----------------------------------------------------------------------

async function getTolaBalance(walletAddress: string): Promise<number> {
    try {
        const connection = new Connection(RPC_URL, 'confirmed');
        const walletPubkey = new PublicKey(walletAddress);
        const mintPubkey = new PublicKey(TOLA_MINT);

        const { value: accounts } = await connection.getTokenAccountsByOwner(walletPubkey, {
            mint: mintPubkey
        });

        let total = 0;
        for (const { account } of accounts) {
            // SPL token account data: amount is at offset 64, 8 bytes LE
            const data = account.data;
            const amount = Number(data.readBigUInt64LE(64));
            total += amount;
        }

        // TOLA has 9 decimals
        return total / 1e9;
    } catch (err: any) {
        logger.error('[Mint Gating] TOLA balance check failed', { wallet: walletAddress, error: err.message });
        return 0;
    }
}

// -----------------------------------------------------------------------
// Gate helpers
// -----------------------------------------------------------------------

function denyResponse(res: Response, details: Record<string, any>): void {
    res.status(403).json({
        ok: false,
        code: 'NOT_ELIGIBLE',
        message: 'Minting is currently available to eligible users only. Please complete onboarding or hold the required TOLA to proceed.',
        details
    });
}

// -----------------------------------------------------------------------
// Middleware
// -----------------------------------------------------------------------

export async function mintGating(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (MODE === 'OFF') {
        next();
        return;
    }

    const wallet = req.body?.recipient_wallet || req.body?.recipient || req.body?.wallet_address || '';

    // All non-OFF modes require a wallet
    if (!wallet) {
        res.status(400).json({
            ok: false,
            code: 'INVALID_SIGNATURE',
            message: 'Wallet address is required for minting.'
        });
        return;
    }

    // ONBOARDING mode
    if (MODE === 'ONBOARDING' || MODE === 'ONBOARDING_OR_TOLA') {
        const onboardingComplete = req.body?.onboardingComplete === true;
        const hmacValid = verifyWpSignature(req);

        if (onboardingComplete && hmacValid) {
            logger.info('[Mint Gating] Onboarding gate passed', { wallet });
            next();
            return;
        }

        // If ONBOARDING_OR_TOLA, fall through to TOLA check
        if (MODE === 'ONBOARDING') {
            logger.warn('[Mint Gating] Onboarding gate denied', { wallet, hmac_valid: hmacValid, onboarding: onboardingComplete });
            denyResponse(res, { mode: MODE, required: 'onboarding_complete', current: onboardingComplete ? 'complete' : 'incomplete' });
            return;
        }
    }

    // TOLA_HOLD or ONBOARDING_OR_TOLA (fallback)
    if (MODE === 'TOLA_HOLD' || MODE === 'ONBOARDING_OR_TOLA') {
        const balance = await getTolaBalance(wallet);
        if (balance >= MIN_TOLA_HOLD) {
            logger.info('[Mint Gating] TOLA hold gate passed', { wallet, balance, required: MIN_TOLA_HOLD });
            next();
            return;
        }
        logger.warn('[Mint Gating] TOLA hold gate denied', { wallet, balance, required: MIN_TOLA_HOLD });
        denyResponse(res, { mode: MODE, required: `${MIN_TOLA_HOLD} TOLA`, current: `${balance} TOLA` });
        return;
    }

    // TOLA_STAKE -- not yet implemented
    if (MODE === 'TOLA_STAKE') {
        logger.warn('[Mint Gating] TOLA_STAKE mode not yet implemented');
        res.status(501).json({
            ok: false,
            code: 'NOT_ELIGIBLE',
            message: 'TOLA staking verification is not yet available. Please use TOLA_HOLD mode or contact support.',
            details: { mode: 'TOLA_STAKE', status: 'not_implemented' }
        });
        return;
    }

    // Unknown mode -- pass through but warn
    logger.warn('[Mint Gating] Unknown gating mode, passing through', { mode: MODE });
    next();
}

logger.info('[Mint Gating] Initialized', { mode: MODE, min_tola_hold: MIN_TOLA_HOLD });
