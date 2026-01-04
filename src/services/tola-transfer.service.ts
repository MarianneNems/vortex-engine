/**
 * TOLA Transfer Service
 * Handles TOLA SPL token transfers on Solana blockchain
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { 
    Connection, 
    PublicKey, 
    Transaction, 
    Keypair,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress, 
    createTransferInstruction,
    getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import bs58 from 'bs58';

export interface TOLATransferRequest {
    user_id: number;
    wallet_address: string;
    amount_tola: number;
    stripe_session_id?: string;
    timestamp?: string;
}

export interface TOLATransferResponse {
    success: boolean;
    signature?: string;
    error?: string;
}

export class TOLATransferService {
    private connection: Connection;
    private tolaMint: PublicKey;
    private treasuryKeypair: Keypair;
    
    constructor() {
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');
        
        // TOLA mint address (update with your actual TOLA mint)
        const tolaMintAddress = process.env.TOLA_MINT || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky';
        this.tolaMint = new PublicKey(tolaMintAddress);
        
        const privateKeyBase58 = process.env.TREASURY_WALLET_PRIVATE;
        if (!privateKeyBase58) {
            throw new Error('TREASURY_WALLET_PRIVATE environment variable not set');
        }
        
        try {
            const privateKeyBytes = bs58.decode(privateKeyBase58);
            this.treasuryKeypair = Keypair.fromSecretKey(privateKeyBytes);
        } catch (error) {
            console.error('[TOLA Transfer] Failed to load treasury keypair:', error);
            throw new Error('Invalid treasury wallet private key');
        }
        
        console.log('[TOLA Transfer] Service initialized with mint:', tolaMintAddress);
    }
    
    /**
     * Transfer TOLA to user wallet
     */
    async transferTOLA(request: TOLATransferRequest): Promise<TOLATransferResponse> {
        try {
            console.log('[TOLA Transfer] Starting transfer:', {
                user_id: request.user_id,
                wallet: request.wallet_address,
                amount: request.amount_tola
            });
            
            const recipientPublicKey = new PublicKey(request.wallet_address);
            
            // Get treasury token account
            const treasuryTokenAccount = await getAssociatedTokenAddress(
                this.tolaMint,
                this.treasuryKeypair.publicKey
            );
            
            // Get or create recipient token account
            let recipientTokenAccount = await getAssociatedTokenAddress(
                this.tolaMint,
                recipientPublicKey
            );
            
            const recipientAccountInfo = await this.connection.getAccountInfo(recipientTokenAccount);
            
            if (!recipientAccountInfo) {
                console.log('[TOLA Transfer] Creating associated token account for recipient');
                const account = await getOrCreateAssociatedTokenAccount(
                    this.connection,
                    this.treasuryKeypair,
                    this.tolaMint,
                    recipientPublicKey
                );
                recipientTokenAccount = account.address;
            }
            
            // TOLA uses 9 decimals (standard for Solana)
            const amountInSmallestUnit = Math.floor(request.amount_tola * 1_000_000_000);
            
            console.log('[TOLA Transfer] Amount in lamports:', amountInSmallestUnit);
            
            // Create transfer instruction
            const transaction = new Transaction().add(
                createTransferInstruction(
                    treasuryTokenAccount,
                    recipientTokenAccount,
                    this.treasuryKeypair.publicKey,
                    amountInSmallestUnit
                )
            );
            
            // Send and confirm transaction
            console.log('[TOLA Transfer] Sending transaction...');
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.treasuryKeypair],
                {
                    commitment: 'confirmed',
                    maxRetries: 3
                }
            );
            
            console.log('[TOLA Transfer] ✅ Success:', {
                signature,
                amount: request.amount_tola,
                recipient: request.wallet_address,
                explorer: `https://solscan.io/tx/${signature}`
            });
            
            return {
                success: true,
                signature: signature
            };
            
        } catch (error: any) {
            console.error('[TOLA Transfer] Error:', error);
            return {
                success: false,
                error: error.message || 'Transfer failed'
            };
        }
    }
    
    /**
     * Get TOLA balance for a wallet
     */
    async getBalance(walletAddress: string): Promise<number> {
        try {
            const publicKey = new PublicKey(walletAddress);
            const tokenAccount = await getAssociatedTokenAddress(
                this.tolaMint,
                publicKey
            );
            
            const balance = await this.connection.getTokenAccountBalance(tokenAccount);
            return balance.value.uiAmount || 0;
            
        } catch (error) {
            console.error('[TOLA Transfer] Balance check error:', error);
            return 0;
        }
    }
    
    /**
     * Verify transaction signature
     */
    async verifyTransaction(signature: string): Promise<boolean> {
        try {
            const confirmation = await this.connection.getSignatureStatus(signature);
            return confirmation?.value?.confirmationStatus === 'confirmed' || 
                   confirmation?.value?.confirmationStatus === 'finalized';
        } catch (error) {
            console.error('[TOLA Transfer] Verification error:', error);
            return false;
        }
    }
    
    /**
     * Get transaction details
     */
    async getTransactionDetails(signature: string) {
        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed'
            });
            
            return {
                success: true,
                transaction: tx,
                slot: tx?.slot,
                blockTime: tx?.blockTime
            };
        } catch (error) {
            console.error('[TOLA Transfer] Transaction details error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

