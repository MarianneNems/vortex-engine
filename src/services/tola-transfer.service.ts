/**
 * TOLA Transfer Service - Production Grade
 * Handles TOLA token transfers on Solana blockchain (incentive distribution)
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Balance caching for performance
 * - Batch transfer support
 * - Multi-RPC failover support
 * - Comprehensive error handling
 * - Transaction logging
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction, 
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress, 
    createTransferInstruction, 
    getAccount, 
    createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import bs58 from 'bs58';
import { logger } from '../utils/logger';

// TOLA Mint Address on Solana Mainnet
const TOLA_MINT = new PublicKey(process.env.TOLA_MINT || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky');
const TOLA_DECIMALS = 9;

// Configuration
const CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    confirmationTimeout: 60000,
    cacheTTL: 30000,
    priorityFee: 50000,
    computeUnits: 150000,
    maxBatchSize: 10
};

// RPC endpoints for failover
const RPC_ENDPOINTS = [
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana'
];

export interface TOLATransferRequest {
    user_id: number;
    wallet_address: string;
    amount_tola: number;
    reason?: 'reward' | 'bonus' | 'airdrop' | 'refund' | 'incentive' | 'other';
    reference?: string;
    metadata?: Record<string, any>;
}

export interface TOLATransferResult {
    success: boolean;
    signature?: string;
    error?: string;
    amount?: number;
    recipient?: string;
    explorer_url?: string;
    reason?: string;
    fee?: number;
}

export interface BatchTransferResult {
    success: boolean;
    total_transfers: number;
    successful: number;
    failed: number;
    results: TOLATransferResult[];
    total_amount: number;
}

interface CacheEntry {
    balance: number;
    timestamp: number;
}

interface TransferLog {
    timestamp: Date;
    user_id: number;
    wallet_address: string;
    amount: number;
    reason: string;
    signature?: string;
    success: boolean;
    error?: string;
}

export class TOLATransferService {
    private connections: Connection[] = [];
    private currentRpcIndex: number = 0;
    private treasuryKeypair: Keypair | null = null;
    private initialized: boolean = false;
    private balanceCache: Map<string, CacheEntry> = new Map();
    private pendingTransfers: Map<string, TOLATransferRequest> = new Map();
    private transferLog: TransferLog[] = [];
    private totalDistributed: number = 0;

    constructor() {
        // Initialize multiple connections for failover
        for (const rpcUrl of RPC_ENDPOINTS) {
            try {
                this.connections.push(new Connection(rpcUrl, {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: CONFIG.confirmationTimeout
                }));
            } catch (e) {
                logger.warn(`[TOLA Service] Failed to connect to ${rpcUrl}`);
            }
        }
        
        if (this.connections.length === 0) {
            logger.error('[TOLA Service] No RPC connections available');
            return;
        }
        
        // Initialize treasury keypair
        const privateKey = process.env.TREASURY_WALLET_PRIVATE;
        if (privateKey) {
            try {
                const decoded = bs58.decode(privateKey);
                this.treasuryKeypair = Keypair.fromSecretKey(decoded);
                this.initialized = true;
                logger.info(`[TOLA Service] Initialized with treasury: ${this.treasuryKeypair.publicKey.toBase58().slice(0, 8)}...`);
            } catch (error: any) {
                logger.error('[TOLA Service] Invalid TREASURY_WALLET_PRIVATE:', error.message);
                this.treasuryKeypair = null;
            }
        } else {
            logger.warn('[TOLA Service] No TREASURY_WALLET_PRIVATE configured - transfers disabled');
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
        logger.info(`[TOLA Service] Switched to RPC ${this.currentRpcIndex + 1}/${this.connections.length}`);
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
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Log transfer for auditing
     */
    private logTransfer(log: TransferLog): void {
        this.transferLog.push(log);
        // Keep only last 1000 entries in memory
        if (this.transferLog.length > 1000) {
            this.transferLog = this.transferLog.slice(-1000);
        }
        if (log.success) {
            this.totalDistributed += log.amount;
        }
    }

    /**
     * Transfer TOLA from treasury to user wallet (single transfer)
     */
    async transferTOLA(request: TOLATransferRequest): Promise<TOLATransferResult> {
        const { wallet_address, amount_tola, user_id, reason = 'incentive' } = request;

        // Validation
        if (!this.initialized || !this.treasuryKeypair) {
            return {
                success: false,
                error: 'Treasury wallet not configured. Please set TREASURY_WALLET_PRIVATE environment variable.'
            };
        }

        if (amount_tola <= 0) {
            return {
                success: false,
                error: 'Amount must be greater than 0'
            };
        }

        // Validate wallet address
        let recipientPubkey: PublicKey;
        try {
            recipientPubkey = new PublicKey(wallet_address);
        } catch (e) {
            return {
                success: false,
                error: 'Invalid wallet address format'
            };
        }

        // Check for duplicate pending transfer
        const transferKey = `${wallet_address}_${amount_tola}_${user_id}`;
        if (this.pendingTransfers.has(transferKey)) {
            return {
                success: false,
                error: 'Duplicate transfer request - please wait'
            };
        }

        this.pendingTransfers.set(transferKey, request);

        try {
            logger.info(`[TOLA Service] Distributing ${amount_tola} TOLA to ${wallet_address} (${reason})`);

            // Retry loop
            let lastError: Error | null = null;
            for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
                try {
                    const result = await this.executeTransfer(recipientPubkey, amount_tola, reason);
                    
                    // Log successful transfer
                    this.logTransfer({
                        timestamp: new Date(),
                        user_id,
                        wallet_address,
                        amount: amount_tola,
                        reason,
                        signature: result.signature,
                        success: true
                    });
                    
                    // Invalidate cache
                    this.balanceCache.delete(wallet_address);
                    this.balanceCache.delete(this.treasuryKeypair!.publicKey.toBase58());
                    
                    return result;
                } catch (error: any) {
                    lastError = error;
                    logger.warn(`[TOLA Service] Transfer attempt ${attempt}/${CONFIG.maxRetries} failed: ${error.message}`);
                    
                    if (attempt < CONFIG.maxRetries) {
                        this.switchRpc();
                        await this.sleep(CONFIG.retryDelay * attempt);
                    }
                }
            }

            // Log failed transfer
            this.logTransfer({
                timestamp: new Date(),
                user_id,
                wallet_address,
                amount: amount_tola,
                reason,
                success: false,
                error: lastError?.message
            });

            return {
                success: false,
                error: lastError?.message || 'Transfer failed after multiple attempts'
            };

        } finally {
            this.pendingTransfers.delete(transferKey);
        }
    }

    /**
     * Execute the actual transfer
     */
    private async executeTransfer(
        recipientPubkey: PublicKey, 
        amount_tola: number,
        reason: string
    ): Promise<TOLATransferResult> {
        const connection = this.getConnection();
        
        // Get token accounts
        const treasuryTokenAccount = await getAssociatedTokenAddress(
            TOLA_MINT,
            this.treasuryKeypair!.publicKey
        );
        
        const recipientTokenAccount = await getAssociatedTokenAddress(
            TOLA_MINT,
            recipientPubkey
        );

        // Build transaction
        const transaction = new Transaction();

        // Add priority fee
        transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: CONFIG.computeUnits }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CONFIG.priorityFee })
        );

        // Check if recipient token account exists
        try {
            await getAccount(connection, recipientTokenAccount);
        } catch (e) {
            logger.info(`[TOLA Service] Creating TOLA token account for recipient`);
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    this.treasuryKeypair!.publicKey,
                    recipientTokenAccount,
                    recipientPubkey,
                    TOLA_MINT
                )
            );
        }

        // Convert amount to smallest unit (TOLA has 9 decimals)
        const amountInSmallestUnit = BigInt(Math.floor(amount_tola * Math.pow(10, TOLA_DECIMALS)));

        // Verify treasury has sufficient balance
        const treasuryBalance = await this.getBalance(this.treasuryKeypair!.publicKey.toBase58());
        if (treasuryBalance < amount_tola) {
            throw new Error(`Insufficient treasury balance: ${treasuryBalance} TOLA available, ${amount_tola} TOLA required`);
        }

        // Create transfer instruction
        transaction.add(
            createTransferInstruction(
                treasuryTokenAccount,
                recipientTokenAccount,
                this.treasuryKeypair!.publicKey,
                amountInSmallestUnit
            )
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.treasuryKeypair!.publicKey;

        // Sign and send
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [this.treasuryKeypair!],
            { commitment: 'confirmed', maxRetries: 3 }
        );

        logger.info(`[TOLA Service] Distribution successful: ${signature}`);

        // Get fee info
        let fee = 0;
        try {
            const txInfo = await connection.getTransaction(signature, { commitment: 'confirmed' });
            fee = (txInfo?.meta?.fee || 0) / LAMPORTS_PER_SOL;
        } catch (e) {}

        return {
            success: true,
            signature,
            amount: amount_tola,
            recipient: recipientPubkey.toBase58(),
            explorer_url: `https://solscan.io/tx/${signature}`,
            reason,
            fee
        };
    }

    /**
     * Batch transfer TOLA to multiple recipients
     */
    async batchTransfer(requests: TOLATransferRequest[]): Promise<BatchTransferResult> {
        if (requests.length > CONFIG.maxBatchSize) {
            return {
                success: false,
                total_transfers: requests.length,
                successful: 0,
                failed: requests.length,
                results: [{ success: false, error: `Batch size exceeds maximum of ${CONFIG.maxBatchSize}` }],
                total_amount: 0
            };
        }

        const results: TOLATransferResult[] = [];
        let successful = 0;
        let totalAmount = 0;

        for (const request of requests) {
            const result = await this.transferTOLA(request);
            results.push(result);
            
            if (result.success) {
                successful++;
                totalAmount += request.amount_tola;
            }
            
            // Small delay between transfers to avoid rate limits
            await this.sleep(500);
        }

        return {
            success: successful > 0,
            total_transfers: requests.length,
            successful,
            failed: requests.length - successful,
            results,
            total_amount: totalAmount
        };
    }

    /**
     * Get TOLA balance for a wallet with caching
     */
    async getBalance(walletAddress: string): Promise<number> {
        // Check cache
        const cached = this.balanceCache.get(walletAddress);
        if (cached && Date.now() - cached.timestamp < CONFIG.cacheTTL) {
            return cached.balance;
        }

        try {
            const pubkey = new PublicKey(walletAddress);
            const tokenAccount = await getAssociatedTokenAddress(TOLA_MINT, pubkey);
            const connection = this.getConnection();
            
            try {
                const account = await getAccount(connection, tokenAccount);
                const balance = Number(account.amount) / Math.pow(10, TOLA_DECIMALS);
                
                this.balanceCache.set(walletAddress, {
                    balance,
                    timestamp: Date.now()
                });
                
                return balance;
            } catch (e) {
                this.balanceCache.set(walletAddress, {
                    balance: 0,
                    timestamp: Date.now()
                });
                return 0;
            }
        } catch (error: any) {
            logger.error('[TOLA Service] Balance check failed:', error.message);
            return 0;
        }
    }

    /**
     * Verify a transaction signature
     */
    async verifyTransaction(signature: string): Promise<{
        verified: boolean;
        status?: string;
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
                error: status.value.err ? JSON.stringify(status.value.err) : undefined
            };
        } catch (error: any) {
            return { verified: false, error: error.message };
        }
    }

    /**
     * Get transfer history (in-memory)
     */
    getTransferHistory(limit: number = 50): TransferLog[] {
        return this.transferLog.slice(-limit);
    }

    /**
     * Get distribution statistics
     */
    getStats(): {
        total_distributed: number;
        total_transfers: number;
        successful_transfers: number;
        failed_transfers: number;
        pending_transfers: number;
    } {
        const successful = this.transferLog.filter(t => t.success).length;
        return {
            total_distributed: this.totalDistributed,
            total_transfers: this.transferLog.length,
            successful_transfers: successful,
            failed_transfers: this.transferLog.length - successful,
            pending_transfers: this.pendingTransfers.size
        };
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
        treasury_balance?: number;
        total_distributed: number;
        cache_size: number;
    }> {
        let treasuryBalance: number | undefined;
        
        if (this.treasuryKeypair) {
            try {
                treasuryBalance = await this.getBalance(this.treasuryKeypair.publicKey.toBase58());
            } catch (e) {}
        }

        return {
            healthy: this.isReady(),
            treasury_configured: !!this.treasuryKeypair,
            rpc_connections: this.connections.length,
            treasury_balance: treasuryBalance,
            total_distributed: this.totalDistributed,
            cache_size: this.balanceCache.size
        };
    }

    /**
     * Get treasury wallet address
     */
    getTreasuryAddress(): string | null {
        return this.treasuryKeypair?.publicKey.toBase58() || null;
    }

    /**
     * Get TOLA contract address
     */
    getContractAddress(): string {
        return TOLA_MINT.toBase58();
    }
}
