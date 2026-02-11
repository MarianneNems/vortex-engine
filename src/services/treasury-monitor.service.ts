/**
 * Treasury Monitor Service
 *
 * Periodically checks the treasury SOL balance and fires alerts
 * when it drops below configurable thresholds.
 *
 * Env vars:
 *   TREASURY_SOL_LOW_THRESHOLD       (default 0.05)
 *   TREASURY_SOL_CRITICAL_THRESHOLD  (default 0.02)
 *   ESTIMATED_MINT_COST_SOL          (default 0.012)
 *   WEBHOOK_ALERT_URL                Slack-compatible webhook URL (optional)
 *   TREASURY_MONITOR_INTERVAL_SEC    Check interval (default 300 = 5 min)
 *
 * @package VortexEngine
 * @version 4.0.0
 */

import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { logger } from '../utils/logger';

const LOW_THRESHOLD = parseFloat(process.env.TREASURY_SOL_LOW_THRESHOLD || '0.05');
const CRITICAL_THRESHOLD = parseFloat(process.env.TREASURY_SOL_CRITICAL_THRESHOLD || '0.02');
const ESTIMATED_MINT_COST = parseFloat(process.env.ESTIMATED_MINT_COST_SOL || '0.012');
const WEBHOOK_URL = process.env.WEBHOOK_ALERT_URL || '';
const INTERVAL_SEC = parseInt(process.env.TREASURY_MONITOR_INTERVAL_SEC || '300', 10);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export type TreasuryStatus = 'OK' | 'LOW' | 'CRITICAL';

export interface TreasuryHealth {
    treasury_public_key: string;
    treasury_sol_balance: number;
    min_required_sol: number;
    low_threshold: number;
    critical_threshold: number;
    status: TreasuryStatus;
    last_checked: string;
}

let cachedHealth: TreasuryHealth | null = null;

function getStatus(balance: number): TreasuryStatus {
    if (balance <= CRITICAL_THRESHOLD) return 'CRITICAL';
    if (balance <= LOW_THRESHOLD) return 'LOW';
    return 'OK';
}

async function sendAlert(health: TreasuryHealth): Promise<void> {
    if (!WEBHOOK_URL) return;
    try {
        // Slack-compatible payload
        const payload = {
            text: `[vortex-engine] Treasury ${health.status}: ${health.treasury_sol_balance.toFixed(4)} SOL (key: ${health.treasury_public_key.slice(0, 8)}...)`,
            // Also include structured fields for non-Slack consumers
            service: 'vortex-engine',
            level: health.status,
            treasury_public_key: health.treasury_public_key,
            treasury_sol_balance: health.treasury_sol_balance,
            time: new Date().toISOString()
        };
        await axios.post(WEBHOOK_URL, payload, { timeout: 5000 });
        logger.info('[Treasury Monitor] Alert sent', { status: health.status });
    } catch (err: any) {
        logger.error('[Treasury Monitor] Alert send failed', { error: err.message });
    }
}

export class TreasuryMonitorService {
    private connection: Connection;
    private treasuryPubkey: PublicKey | null = null;
    private intervalHandle: ReturnType<typeof setInterval> | null = null;

    constructor(treasuryPublicKey?: string) {
        this.connection = new Connection(RPC_URL, 'confirmed');

        if (treasuryPublicKey) {
            try {
                this.treasuryPubkey = new PublicKey(treasuryPublicKey);
            } catch {
                logger.error('[Treasury Monitor] Invalid treasury public key');
            }
        }
    }

    /** Start periodic monitoring */
    start(): void {
        if (!this.treasuryPubkey) {
            logger.warn('[Treasury Monitor] No treasury key -- monitoring disabled');
            return;
        }

        // Immediate first check
        this.check().catch(() => {});

        // Periodic
        this.intervalHandle = setInterval(() => {
            this.check().catch(() => {});
        }, INTERVAL_SEC * 1000);

        logger.info('[Treasury Monitor] Started', {
            interval_sec: INTERVAL_SEC,
            low_threshold: LOW_THRESHOLD,
            critical_threshold: CRITICAL_THRESHOLD
        });
    }

    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    /** Check balance and alert if needed */
    async check(): Promise<TreasuryHealth> {
        if (!this.treasuryPubkey) {
            throw new Error('Treasury public key not configured');
        }

        let balance = 0;
        try {
            const lamports = await this.connection.getBalance(this.treasuryPubkey);
            balance = lamports / LAMPORTS_PER_SOL;
        } catch (err: any) {
            logger.error('[Treasury Monitor] Balance fetch failed', { error: err.message });
        }

        const status = getStatus(balance);
        const health: TreasuryHealth = {
            treasury_public_key: this.treasuryPubkey.toBase58(),
            treasury_sol_balance: balance,
            min_required_sol: ESTIMATED_MINT_COST,
            low_threshold: LOW_THRESHOLD,
            critical_threshold: CRITICAL_THRESHOLD,
            status,
            last_checked: new Date().toISOString()
        };

        cachedHealth = health;

        if (status !== 'OK') {
            logger.warn(`[Treasury Monitor] Status: ${status}`, {
                balance,
                threshold: status === 'CRITICAL' ? CRITICAL_THRESHOLD : LOW_THRESHOLD
            });
            await sendAlert(health);
        } else {
            logger.debug('[Treasury Monitor] OK', { balance });
        }

        return health;
    }

    /** Get cached health (non-blocking) */
    getCachedHealth(): TreasuryHealth | null {
        return cachedHealth;
    }

    /** Pre-mint balance guard -- returns null if OK, error body if not */
    async preMintCheck(requestId: string): Promise<Record<string, any> | null> {
        if (!this.treasuryPubkey) return null; // Can't check = pass through

        let balance: number;
        try {
            const lamports = await this.connection.getBalance(this.treasuryPubkey);
            balance = lamports / LAMPORTS_PER_SOL;
        } catch {
            // RPC failure -- don't block the mint, let it fail naturally
            return null;
        }

        if (balance < ESTIMATED_MINT_COST) {
            logger.error('[Treasury Monitor] Insufficient SOL for mint', {
                balance,
                required: ESTIMATED_MINT_COST,
                request_id: requestId
            });
            return {
                ok: false,
                success: false,
                code: 'INSUFFICIENT_TREASURY_SOL',
                message: 'Minting is temporarily paused while we replenish network fees. Please try again soon.',
                request_id: requestId
            };
        }

        return null;
    }
}

export const ESTIMATED_MINT_COST_SOL = ESTIMATED_MINT_COST;
