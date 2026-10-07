/**
 * USDC Transfer Service - Production Grade
 * Handles USDC token transfers on Solana blockchain
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Balance caching for performance
 * - Transaction confirmation tracking
 * - Multi-RPC failover support
 * - Comprehensive error handling
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction, 
    SendTransactionError,
    TransactionInstruction,
    ComputeBudgetProgram,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress, 
    createTransferInstruction, 
    getAccount, 
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';
import crypto from 'crypto';
import { logger } from '../utils/logger';

// USDC Mint Address on Solana Mainnet
const USDC_MINT = new PublicKey(process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

// Configuration
const CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    confirmationTimeout: 60000,
    cacheTTL: 30000, // 30 seconds
    priorityFee: 50000, // microlamports
    computeUnits: 100000
};

// RPC endpoints for failover
const RPC_ENDPOINTS = [
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana'
];

/**
 * Marks a transfer request that came through the signed payout endpoint (requirePayoutHmac sets it on the request).
 * transferUSDC refuses every other caller, so an unsigned path (a webhook, a new route) cannot move USDC.
 */
export const SIGNED_PAYOUT: unique symbol = Symbol('vortex.signed-payout');

// Memo program: every payout carries a mark derived from its idempotency key, the durable record of "already paid".
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// Treasury transactions searched for an earlier payout with the same key before a new one is sent.
const PAYOUT_LOOKBACK = 1000;
const PAYOUT_KEY_PATTERN = /^[A-Za-z0-9:_.\-]{8,120}$/;

/** The on-chain mark of a payout: fixed length, so one mark is never part of another, and it does not reveal the key. */
export function payoutMark(key: string): string {
    return 'vortex-payout:' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export interface USDCTransferRequest {
    user_id: number;
    wallet_address: string;
    amount_usdc: number;
    order_id?: string;
    reference?: string;
    metadata?: Record<string, any>;
    /** One key per payout (8 to 120 of A-Z a-z 0-9 : _ . -). The same key is never paid twice. */
    idempotency_key?: string;
}

export interface USDCTransferResult {
    success: boolean;
    signature?: string;
    error?: string;
    /** Why a payout was refused or not finished: PAYOUT_NOT_SIGNED, PAYOUT_DUPLICATE, PAYOUT_OUTCOME_UNKNOWN, ... */
    code?: string;
    amount?: number;
    recipient?: string;
    explorer_url?: string;
    block_time?: number;
    fee?: number;
}

export interface BalanceInfo {
    balance: number;
    wallet: string;
    cached: boolean;
    timestamp: number;
}

interface CacheEntry {
    balance: number;
    timestamp: number;
}

export class USDCTransferService {
    private connections: Connection[] = [];
    private currentRpcIndex: number = 0;
    private treasuryKeypair: Keypair | null = null;
    private initialized: boolean = false;
    private balanceCache: Map<string, CacheEntry> = new Map();
    private pendingTransfers: Map<string, USDCTransferRequest> = new Map(); // idempotency key -> payout in progress
    private completedPayouts: Map<string, string> = new Map();              // idempotency key -> signature, this process
    private unresolvedPayouts: Map<string, { signature: string; lastValidBlockHeight: number }> = new Map();

    constructor() {
        // Initialize multiple connections for failover
        for (const rpcUrl of RPC_ENDPOINTS) {
            try {
                this.connections.push(new Connection(rpcUrl, {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: CONFIG.confirmationTimeout
                }));
            } catch (e) {
                logger.warn(`[USDC Service] Failed to connect to ${rpcUrl}`);
            }
        }
        
        if (this.connections.length === 0) {
            logger.error('[USDC Service] No RPC connections available');
            return;
        }
        
        // The payout treasury has its own key, PAYOUT_TREASURY_PRIVATE (2026-10-07), read here and nowhere else.
        // TREASURY_WALLET_PRIVATE is also read by the TOLA transfer, NFT mint, collection and marketplace services,
        // whose routes take only the shared API key: payouts never fall back to it, and a payout key for the same
        // wallet is refused, so payout funds cannot be reached through those routes. No dedicated key, no payouts.
        // Trimmed: a value pasted into a dashboard often carries an invisible newline.
        const privateKey = (process.env.PAYOUT_TREASURY_PRIVATE || '').trim();
        if (privateKey) {
            try {
                const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
                let shared: PublicKey | null = null;
                try {
                    shared = Keypair.fromSecretKey(bs58.decode((process.env.TREASURY_WALLET_PRIVATE || '').trim())).publicKey;
                } catch (e) {
                    shared = null; // absent or unreadable: no other service can sign with it either
                }
                if (shared && shared.equals(keypair.publicKey)) {
                    logger.error('[USDC Service] PAYOUT_TREASURY_PRIVATE is the TREASURY_WALLET_PRIVATE wallet - payouts disabled; use a wallet that only pays out');
                } else {
                    this.treasuryKeypair = keypair;
                    this.initialized = true;
                    logger.info(`[USDC Service] Initialized with payout treasury: ${keypair.publicKey.toBase58().slice(0, 8)}...`);
                }
            } catch (error: any) {
                logger.error('[USDC Service] Invalid PAYOUT_TREASURY_PRIVATE - check Base58 encoding:', error.message);
                this.treasuryKeypair = null;
            }
        } else {
            logger.warn('[USDC Service] No PAYOUT_TREASURY_PRIVATE configured - payouts disabled');
        }
        
        // Start cache cleanup interval
        setInterval(() => this.cleanupCache(), CONFIG.cacheTTL);
    }

    /**
     * Get active connection with failover
     */
    private getConnection(): Connection {
        return this.connections[this.currentRpcIndex] || this.connections[0];
    }

    /**
     * Switch to next RPC endpoint
     */
    private switchRpc(): void {
        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.connections.length;
        logger.info(`[USDC Service] Switched to RPC ${this.currentRpcIndex + 1}/${this.connections.length}`);
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.balanceCache.entries()) {
            if (now - entry.timestamp > CONFIG.cacheTTL) {
                this.balanceCache.delete(key);
            }
        }
    }

    /**
     * Sleep helper for retry delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Transfer USDC from the treasury to a wallet: one payout per idempotency_key, and only for a request that came
     * through the signed payout endpoint (2026-10-07).
     *
     * A repeat is refused three ways: a payout with the same key already in progress here; one already made
     * (remembered here and, durably, on chain: every payout carries a memo derived from its key, and the treasury's
     * recent transactions are searched for it before anything is sent); and an earlier attempt whose outcome is not
     * known yet (refused until its blockhash has expired, when it can no longer land). A transaction is signed once
     * and never rebuilt: a send whose outcome is unknown is reported, not repeated. If the treasury history cannot be
     * read, nothing is sent.
     */
    async transferUSDC(request: USDCTransferRequest, via?: symbol): Promise<USDCTransferResult> {
        const { wallet_address, amount_usdc, order_id } = request;

        if (via !== SIGNED_PAYOUT) {
            logger.warn('[USDC Service] Refused a transfer that did not come through the signed payout endpoint');
            return {
                success: false,
                code: 'PAYOUT_NOT_SIGNED',
                error: 'Payouts are accepted only through the signed transfer endpoint.'
            };
        }

        // Validation
        if (!this.initialized || !this.treasuryKeypair) {
            return {
                success: false,
                code: 'PAYOUT_NOT_CONFIGURED',
                error: 'The payout treasury is not configured (PAYOUT_TREASURY_PRIVATE, a wallet used only for payouts).'
            };
        }

        const key = String(request.idempotency_key ?? '');
        if (!PAYOUT_KEY_PATTERN.test(key)) {
            return {
                success: false,
                code: 'PAYOUT_KEY_REQUIRED',
                error: 'idempotency_key is required: 8 to 120 letters, digits or : _ . -, one per payout.'
            };
        }

        const amount = Number(amount_usdc);
        const scale = Math.pow(10, USDC_DECIMALS);
        const units = Math.round(amount * scale);
        if (!Number.isFinite(amount) || amount <= 0 || units < 1 || Math.abs(amount * scale - units) > 1e-6) {
            return {
                success: false,
                code: 'PAYOUT_INVALID_AMOUNT',
                error: 'Amount must be a positive number of USDC with at most 6 decimals'
            };
        }

        // Validate wallet address
        let recipientPubkey: PublicKey;
        try {
            recipientPubkey = new PublicKey(wallet_address);
        } catch (e) {
            return {
                success: false,
                code: 'PAYOUT_INVALID_WALLET',
                error: 'Invalid wallet address format'
            };
        }
        if (!PublicKey.isOnCurve(recipientPubkey.toBytes()) || recipientPubkey.equals(this.treasuryKeypair.publicKey)) {
            return {
                success: false,
                code: 'PAYOUT_INVALID_WALLET',
                error: 'The recipient must be a wallet address other than the treasury'
            };
        }

        if (this.pendingTransfers.has(key)) {
            return {
                success: false,
                code: 'PAYOUT_IN_PROGRESS',
                error: 'A payout with this idempotency_key is already in progress.'
            };
        }
        this.pendingTransfers.set(key, request);

        try {
            const made = this.completedPayouts.get(key);
            if (made) {
                return { success: false, code: 'PAYOUT_DUPLICATE', signature: made, error: 'This payout was already made.' };
            }

            const open = await this.settleUnresolved(key);
            if (open) { return open; }

            let earlier: string | null;
            try {
                earlier = await this.findPayoutOnChain(key);
            } catch (error: any) {
                logger.error(`[USDC Service] Treasury history unreadable, payout refused: ${error.message}`);
                return {
                    success: false,
                    code: 'PAYOUT_LEDGER_UNAVAILABLE',
                    error: 'The treasury history could not be read, so a repeat cannot be ruled out. Nothing was sent.'
                };
            }
            if (earlier) {
                this.completedPayouts.set(key, earlier);
                return { success: false, code: 'PAYOUT_DUPLICATE', signature: earlier, error: 'This payout was already made.' };
            }

            logger.info(`[USDC Service] Initiating transfer of ${amount} USDC to ${wallet_address}`);
            const result = await this.executeTransfer(recipientPubkey, units, key, order_id);
            if (result.success && result.signature) {
                this.completedPayouts.set(key, result.signature);
            }

            // Invalidate cache for both wallets
            this.balanceCache.delete(wallet_address);
            this.balanceCache.delete(this.treasuryKeypair.publicKey.toBase58());

            return result;
        } catch (error: any) {
            // executeTransfer throws only before the transaction is signed: nothing was sent.
            return { success: false, code: 'PAYOUT_FAILED', error: error.message || 'Transfer failed' };
        } finally {
            this.pendingTransfers.delete(key);
        }
    }

    /**
     * Build one payout transaction (with its memo), sign it once, send it and confirm it. Throws only before the
     * transaction is signed, when nothing has been sent; after that every path returns.
     */
    private async executeTransfer(
        recipientPubkey: PublicKey,
        units: number,
        key: string,
        order_id?: string
    ): Promise<USDCTransferResult> {
        const connection = this.getConnection();
        const amount_usdc = units / Math.pow(10, USDC_DECIMALS);

        // Get token accounts
        const treasuryTokenAccount = await getAssociatedTokenAddress(
            USDC_MINT,
            this.treasuryKeypair!.publicKey
        );

        const recipientTokenAccount = await getAssociatedTokenAddress(
            USDC_MINT,
            recipientPubkey
        );

        // Build transaction
        const transaction = new Transaction();

        // Add priority fee for faster confirmation
        transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: CONFIG.computeUnits }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CONFIG.priorityFee })
        );

        // Check if recipient token account exists
        try {
            await getAccount(connection, recipientTokenAccount);
        } catch (e) {
            // Create associated token account for recipient
            logger.info(`[USDC Service] Creating USDC token account for recipient`);
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    this.treasuryKeypair!.publicKey,
                    recipientTokenAccount,
                    recipientPubkey,
                    USDC_MINT
                )
            );
        }

        // Verify treasury has sufficient balance
        const treasuryBalance = await this.getBalance(this.treasuryKeypair!.publicKey.toBase58());
        if (treasuryBalance < amount_usdc) {
            throw new Error(`Insufficient treasury balance: ${treasuryBalance} USDC available, ${amount_usdc} USDC required`);
        }

        // The payout's mark on chain: a repeat of its key is recognised even after a restart
        transaction.add(
            new TransactionInstruction({
                keys: [{ pubkey: this.treasuryKeypair!.publicKey, isSigner: true, isWritable: false }],
                programId: MEMO_PROGRAM_ID,
                data: Buffer.from(payoutMark(key), 'utf8')
            })
        );

        // Create transfer instruction (amount in the smallest unit: USDC has 6 decimals)
        transaction.add(
            createTransferInstruction(
                treasuryTokenAccount,
                recipientTokenAccount,
                this.treasuryKeypair!.publicKey,
                BigInt(units)
            )
        );

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.treasuryKeypair!.publicKey;

        // Sign once. The signature is known before sending, so an unknown outcome can always be looked up.
        transaction.sign(this.treasuryKeypair!);
        const signature = bs58.encode(transaction.signature as Buffer);
        this.unresolvedPayouts.set(key, { signature, lastValidBlockHeight });

        try {
            await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3, preflightCommitment: 'confirmed' });
        } catch (error: any) {
            if (error instanceof SendTransactionError) {
                // Refused by the node before acceptance (simulation, blockhash): it cannot land.
                this.unresolvedPayouts.delete(key);
                return { success: false, code: 'PAYOUT_FAILED', error: error.message };
            }
            logger.error(`[USDC Service] Payout ${signature} sent with an unknown outcome: ${error.message}`);
            return this.unknownOutcome(signature);
        }

        try {
            const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
            if (confirmation.value.err) {
                this.unresolvedPayouts.delete(key);
                return { success: false, code: 'PAYOUT_FAILED', signature, error: 'The payout failed on chain: ' + JSON.stringify(confirmation.value.err) };
            }
        } catch (error: any) {
            const state = await this.signatureState(signature, lastValidBlockHeight);
            if ('failed' === state || 'expired' === state) {
                this.unresolvedPayouts.delete(key);
                return {
                    success: false,
                    code: 'PAYOUT_FAILED',
                    signature,
                    error: 'expired' === state ? 'The payout expired before it landed; nothing was paid.' : 'The payout failed on chain.'
                };
            }
            if ('landed' !== state) {
                return this.unknownOutcome(signature);
            }
        }
        this.unresolvedPayouts.delete(key);

        logger.info(`[USDC Service] Transfer successful: ${signature}`);

        // Get transaction details for fee info
        let fee = 0;
        try {
            const txInfo = await connection.getTransaction(signature, { commitment: 'confirmed' });
            fee = (txInfo?.meta?.fee || 0) / LAMPORTS_PER_SOL;
        } catch (e) {
            // Fee info not critical
        }

        return {
            success: true,
            signature,
            amount: amount_usdc,
            recipient: recipientPubkey.toBase58(),
            explorer_url: `https://solscan.io/tx/${signature}`,
            fee
        };
    }

    /** A payout that was sent but whose outcome is not known yet: never sent again; a repeat of its key answers it. */
    private unknownOutcome(signature: string): USDCTransferResult {
        return {
            success: false,
            code: 'PAYOUT_OUTCOME_UNKNOWN',
            signature,
            error: 'The payout was sent but its outcome is not known yet. Do not pay again: repeat the request with the same idempotency_key after a minute and it returns the result.'
        };
    }

    /** Where one signature stands: landed, failed on chain, expired (can no longer land) or unknown. Never throws. */
    private async signatureState(signature: string, lastValidBlockHeight: number): Promise<'landed' | 'failed' | 'expired' | 'unknown'> {
        try {
            const connection = this.getConnection();
            const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
            if (value && ('confirmed' === value.confirmationStatus || 'finalized' === value.confirmationStatus)) {
                return value.err ? 'failed' : 'landed';
            }
            const height = await connection.getBlockHeight('confirmed');
            return height > lastValidBlockHeight ? 'expired' : 'unknown';
        } catch (e) {
            return 'unknown';
        }
    }

    /** An earlier attempt with this key whose outcome was unknown: answers the repeat, or clears the way once it cannot land. */
    private async settleUnresolved(key: string): Promise<USDCTransferResult | null> {
        const open = this.unresolvedPayouts.get(key);
        if (!open) { return null; }
        const state = await this.signatureState(open.signature, open.lastValidBlockHeight);
        if ('landed' === state) {
            this.unresolvedPayouts.delete(key);
            this.completedPayouts.set(key, open.signature);
            return { success: false, code: 'PAYOUT_DUPLICATE', signature: open.signature, error: 'This payout was already made.' };
        }
        if ('unknown' === state) {
            return {
                success: false,
                code: 'PAYOUT_IN_PROGRESS',
                signature: open.signature,
                error: 'An earlier attempt with this idempotency_key may still land; repeat the request after a minute.'
            };
        }
        this.unresolvedPayouts.delete(key); // failed or expired: it can no longer pay
        return null;
    }

    /** The signature of an earlier successful payout with this key among the treasury's recent transactions, or null. */
    private async findPayoutOnChain(key: string): Promise<string | null> {
        const mark = payoutMark(key);
        const recent = await this.getConnection().getSignaturesForAddress(this.treasuryKeypair!.publicKey, { limit: PAYOUT_LOOKBACK }, 'confirmed');
        for (const s of recent) {
            if (!s.err && typeof s.memo === 'string' && s.memo.includes(mark)) { return s.signature; }
        }
        return null;
    }

    /** The HTTP status for a payout result. */
    statusFor(result: USDCTransferResult): number {
        if (result.success) { return 200; }
        switch (result.code) {
            case 'PAYOUT_NOT_SIGNED': return 401;
            case 'PAYOUT_KEY_REQUIRED':
            case 'PAYOUT_INVALID_AMOUNT':
            case 'PAYOUT_INVALID_WALLET': return 400;
            case 'PAYOUT_DUPLICATE':
            case 'PAYOUT_IN_PROGRESS': return 409;
            case 'PAYOUT_NOT_CONFIGURED':
            case 'PAYOUT_LEDGER_UNAVAILABLE': return 503;
            case 'PAYOUT_OUTCOME_UNKNOWN': return 202;
            default: return 500;
        }
    }

    /**
     * Get USDC balance for a wallet with caching
     */
    async getBalance(walletAddress: string): Promise<number> {
        // Check cache first
        const cached = this.balanceCache.get(walletAddress);
        if (cached && Date.now() - cached.timestamp < CONFIG.cacheTTL) {
            return cached.balance;
        }

        try {
            const pubkey = new PublicKey(walletAddress);
            const tokenAccount = await getAssociatedTokenAddress(USDC_MINT, pubkey);
            const connection = this.getConnection();
            
            try {
                const account = await getAccount(connection, tokenAccount);
                const balance = Number(account.amount) / Math.pow(10, USDC_DECIMALS);
                
                // Cache the result
                this.balanceCache.set(walletAddress, {
                    balance,
                    timestamp: Date.now()
                });
                
                return balance;
            } catch (e) {
                // Token account doesn't exist - balance is 0
                this.balanceCache.set(walletAddress, {
                    balance: 0,
                    timestamp: Date.now()
                });
                return 0;
            }
        } catch (error: any) {
            logger.error('[USDC Service] Balance check failed:', error.message);
            return 0;
        }
    }

    /**
     * Get balance with full info
     */
    async getBalanceInfo(walletAddress: string): Promise<BalanceInfo> {
        const cached = this.balanceCache.get(walletAddress);
        const isCached = cached && Date.now() - cached.timestamp < CONFIG.cacheTTL;
        
        const balance = await this.getBalance(walletAddress);
        
        return {
            balance,
            wallet: walletAddress,
            cached: !!isCached,
            timestamp: Date.now()
        };
    }

    /**
     * Verify a transaction signature
     */
    async verifyTransaction(signature: string): Promise<{
        verified: boolean;
        status?: string;
        confirmations?: number;
        error?: string;
    }> {
        try {
            const connection = this.getConnection();
            const status = await connection.getSignatureStatus(signature, {
                searchTransactionHistory: true
            });
            
            if (!status.value) {
                return { verified: false, status: 'not_found' };
            }

            const confirmed = status.value.confirmationStatus === 'confirmed' || 
                             status.value.confirmationStatus === 'finalized';
            
            return {
                verified: confirmed && !status.value.err,
                status: status.value.confirmationStatus || 'unknown',
                confirmations: status.value.confirmations || 0,
                error: status.value.err ? JSON.stringify(status.value.err) : undefined
            };
        } catch (error: any) {
            logger.error('[USDC Service] Verification failed:', error.message);
            return { verified: false, error: error.message };
        }
    }

    /**
     * Get transaction details
     */
    async getTransaction(signature: string): Promise<any> {
        try {
            const connection = this.getConnection();
            const tx = await connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            return {
                success: true,
                data: tx ? {
                    signature,
                    slot: tx.slot,
                    blockTime: tx.blockTime,
                    fee: tx.meta?.fee,
                    status: tx.meta?.err ? 'failed' : 'success',
                    preBalances: tx.meta?.preTokenBalances,
                    postBalances: tx.meta?.postTokenBalances
                } : null
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return this.initialized && this.connections.length > 0;
    }

    /**
     * Get service health status
     */
    async getHealth(): Promise<{
        healthy: boolean;
        treasury_configured: boolean;
        rpc_connections: number;
        current_rpc: number;
        treasury_balance?: number;
        cache_size: number;
        pending_transfers: number;
    }> {
        let treasuryBalance: number | undefined;
        
        if (this.treasuryKeypair) {
            try {
                treasuryBalance = await this.getBalance(this.treasuryKeypair.publicKey.toBase58());
            } catch (e) {
                // Unable to fetch balance
            }
        }

        return {
            healthy: this.isReady(),
            treasury_configured: !!this.treasuryKeypair,
            rpc_connections: this.connections.length,
            current_rpc: this.currentRpcIndex + 1,
            treasury_balance: treasuryBalance,
            cache_size: this.balanceCache.size,
            pending_transfers: this.pendingTransfers.size
        };
    }

    /**
     * Get treasury wallet address
     */
    getTreasuryAddress(): string | null {
        return this.treasuryKeypair?.publicKey.toBase58() || null;
    }
}
