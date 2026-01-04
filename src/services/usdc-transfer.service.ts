/**
 * USDC Transfer Service
 * Handles USDC SPL token transfers on Solana blockchain
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

export interface USDCTransferRequest {
    user_id: number;
    wallet_address: string;
    amount_usdc: number;
    stripe_payment_intent: string;
    stripe_session_id: string;
}

export interface USDCTransferResponse {
    success: boolean;
    tx_signature?: string;
    error?: string;
}

export class USDCTransferService {
    private connection: Connection;
    private usdcMint: PublicKey;
    private treasuryKeypair: Keypair;
    
    constructor() {
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');
        
        const usdcMintAddress = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        this.usdcMint = new PublicKey(usdcMintAddress);
        
        const privateKeyBase58 = process.env.TREASURY_WALLET_PRIVATE;
        if (!privateKeyBase58) {
            throw new Error('TREASURY_WALLET_PRIVATE environment variable not set');
        }
        
        try {
            const privateKeyBytes = bs58.decode(privateKeyBase58);
            this.treasuryKeypair = Keypair.fromSecretKey(privateKeyBytes);
        } catch (error) {
            console.error('[USDC Transfer] Failed to load treasury keypair:', error);
            throw new Error('Invalid treasury wallet private key');
        }
    }
    
    /**
     * Transfer USDC to user wallet
     */
    async transferUSDC(request: USDCTransferRequest): Promise<USDCTransferResponse> {
        try {
            console.log('[USDC Transfer] Starting transfer:', {
                user_id: request.user_id,
                wallet: request.wallet_address,
                amount: request.amount_usdc
            });
            
            const recipientPublicKey = new PublicKey(request.wallet_address);
            
            const treasuryTokenAccount = await getAssociatedTokenAddress(
                this.usdcMint,
                this.treasuryKeypair.publicKey
            );
            
            let recipientTokenAccount = await getAssociatedTokenAddress(
                this.usdcMint,
                recipientPublicKey
            );
            
            const recipientAccountInfo = await this.connection.getAccountInfo(recipientTokenAccount);
            
            if (!recipientAccountInfo) {
                console.log('[USDC Transfer] Creating associated token account for recipient');
                const account = await getOrCreateAssociatedTokenAccount(
                    this.connection,
                    this.treasuryKeypair,
                    this.usdcMint,
                    recipientPublicKey
                );
                recipientTokenAccount = account.address;
            }
            
            const amountInSmallestUnit = Math.floor(request.amount_usdc * 1_000_000);
            
            const transaction = new Transaction().add(
                createTransferInstruction(
                    treasuryTokenAccount,
                    recipientTokenAccount,
                    this.treasuryKeypair.publicKey,
                    amountInSmallestUnit
                )
            );
            
            console.log('[USDC Transfer] Sending transaction...');
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.treasuryKeypair],
                {
                    commitment: 'confirmed',
                    maxRetries: 3
                }
            );
            
            console.log('[USDC Transfer] Success:', {
                signature,
                amount: request.amount_usdc,
                recipient: request.wallet_address
            });
            
            return {
                success: true,
                tx_signature: signature
            };
            
        } catch (error: any) {
            console.error('[USDC Transfer] Error:', error);
            return {
                success: false,
                error: error.message || 'Transfer failed'
            };
        }
    }
    
    /**
     * Get USDC balance for a wallet
     */
    async getBalance(walletAddress: string): Promise<number> {
        try {
            const publicKey = new PublicKey(walletAddress);
            const tokenAccount = await getAssociatedTokenAddress(
                this.usdcMint,
                publicKey
            );
            
            const balance = await this.connection.getTokenAccountBalance(tokenAccount);
            return balance.value.uiAmount || 0;
            
        } catch (error) {
            console.error('[USDC Transfer] Balance check error:', error);
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
            console.error('[USDC Transfer] Verification error:', error);
            return false;
        }
    }
}

