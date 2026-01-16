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
    sendAndConfirmTransaction,
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

export interface USDCTransferRequest {
    user_id: number;
    wallet_address: string;
    amount_usdc: number;
    order_id?: string;
    reference?: string;
    metadata?: Record<string, any>;
}

export interface USDCTransferResult {
    success: boolean;
    signature?: string;
    error?: string;
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
    private pendingTransfers: Map<string, USDCTransferRequest> = new Map();

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
        
        // Initialize treasury keypair
        const privateKey = process.env.TREASURY_WALLET_PRIVATE;
        if (privateKey) {
            try {
                const decoded = bs58.decode(privateKey);
                this.treasuryKeypair = Keypair.fromSecretKey(decoded);
                this.initialized = true;
                logger.info(`[USDC Service] Initialized with treasury: ${this.treasuryKeypair.publicKey.toBase58().slice(0, 8)}...`);
            } catch (error: any) {
                logger.error('[USDC Service] Invalid TREASURY_WALLET_PRIVATE - check Base58 encoding:', error.message);
                this.treasuryKeypair = null;
            }
        } else {
            logger.warn('[USDC Service] No TREASURY_WALLET_PRIVATE configured - transfers disabled');
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
     * Transfer USDC from treasury to user wallet with retry logic
     */
    async transferUSDC(request: USDCTransferRequest): Promise<USDCTransferResult> {
        const { wallet_address, amount_usdc, order_id } = request;

        // Validation
        if (!this.initialized || !this.treasuryKeypair) {
            return {
                success: false,
                error: 'Treasury wallet not configured. Please set TREASURY_WALLET_PRIVATE environment variable.'
            };
        }

        if (amount_usdc <= 0) {
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
        const transferKey = `${wallet_address}_${amount_usdc}_${order_id || Date.now()}`;
        if (this.pendingTransfers.has(transferKey)) {
            return {
                success: false,
                error: 'Duplicate transfer request - please wait for the current transfer to complete'
            };
        }

        this.pendingTransfers.set(transferKey, request);

        try {
            logger.info(`[USDC Service] Initiating transfer of ${amount_usdc} USDC to ${wallet_address}`);

            // Retry loop with exponential backoff
            let lastError: Error | null = null;
            for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
                try {
                    const result = await this.executeTransfer(recipientPubkey, amount_usdc, order_id);
                    
                    // Invalidate cache for both wallets
                    this.balanceCache.delete(wallet_address);
                    this.balanceCache.delete(this.treasuryKeypair!.publicKey.toBase58());
                    
                    return result;
                } catch (error: any) {
                    lastError = error;
                    logger.warn(`[USDC Service] Transfer attempt ${attempt}/${CONFIG.maxRetries} failed: ${error.message}`);
                    
                    if (attempt < CONFIG.maxRetries) {
                        // Switch RPC and wait before retry
                        this.switchRpc();
                        await this.sleep(CONFIG.retryDelay * attempt);
                    }
                }
            }

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
        amount_usdc: number,
        order_id?: string
    ): Promise<USDCTransferResult> {
        const connection = this.getConnection();
        
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

        // Convert amount to smallest unit (USDC has 6 decimals)
        const amountInSmallestUnit = BigInt(Math.floor(amount_usdc * Math.pow(10, USDC_DECIMALS)));

        // Verify treasury has sufficient balance
        const treasuryBalance = await this.getBalance(this.treasuryKeypair!.publicKey.toBase58());
        if (treasuryBalance < amount_usdc) {
            throw new Error(`Insufficient treasury balance: ${treasuryBalance} USDC available, ${amount_usdc} USDC required`);
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
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.treasuryKeypair!.publicKey;

        // Sign and send transaction
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [this.treasuryKeypair!],
            { 
                commitment: 'confirmed',
                maxRetries: 3
            }
        );

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
