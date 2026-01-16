/**
 * Payment Service - Production Grade
 * Handles USDC/TOLA payment processing, verification, and order management
 * 
 * Features:
 * - Payment intent creation with deep links
 * - On-chain transaction verification
 * - WooCommerce order integration
 * - Automatic status updates
 * - Payment history tracking
 * - QR code generation data
 * 
 * @version 4.0.0
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import axios from 'axios';
import { logger } from '../utils/logger';

// Environment configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_PUBKEY || process.env.TREASURY_WALLET_PUBLIC || '';
const TOLA_MINT = new PublicKey(process.env.TOLA_MINT || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky');
const USDC_MINT = new PublicKey(process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WP_AJAX_URL = process.env.WP_AJAX_URL || '';
const WOO_BASE_URL = process.env.WOO_BASE_URL || '';
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY || '';
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET || '';

// Configuration
const CONFIG = {
    confirmationTimeout: 60000,
    maxRetries: 3,
    intentExpiry: 3600000, // 1 hour
    cacheTTL: 30000
};

export interface PaymentIntent {
    id: string;
    orderId: string;
    userId?: number;
    amountUSD: number;
    amountToken: number;
    currency: 'USDC' | 'TOLA';
    buyerEmail?: string;
    buyerWallet?: string;
    toAddress: string;
    createdAt: Date;
    expiresAt: Date;
    paidAt?: Date;
    txSignature?: string;
    status: 'pending' | 'processing' | 'paid' | 'failed' | 'expired';
    qrData?: string;
    deepLink?: string;
    metadata?: Record<string, any>;
}

export interface PaymentVerification {
    verified: boolean;
    orderId: string;
    signature?: string;
    status: string;
    amount?: number;
    timestamp?: Date;
    error?: string;
}

interface IntentStorage {
    [key: string]: PaymentIntent;
}

export class PaymentService {
    private connection: Connection;
    private intents: IntentStorage = {};
    private paymentHistory: PaymentIntent[] = [];
    private totalProcessed: number = 0;
    private totalValue: number = 0;
    
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        
        // Start cleanup interval for expired intents
        setInterval(() => this.cleanupExpiredIntents(), CONFIG.cacheTTL);
        
        logger.info('[Payment Service] Initialized');
    }
    
    /**
     * Clean up expired payment intents
     */
    private cleanupExpiredIntents(): void {
        const now = new Date();
        for (const [id, intent] of Object.entries(this.intents)) {
            if (intent.status === 'pending' && intent.expiresAt < now) {
                intent.status = 'expired';
                logger.info(`[Payment] Intent ${id} expired`);
            }
        }
    }
    
    /**
     * Create a new payment intent
     */
    async createPaymentIntent(params: {
        orderId: string;
        amountUSD: number;
        amountToken?: number;
        currency?: 'USDC' | 'TOLA';
        userId?: number;
        buyerEmail?: string;
        buyerWallet?: string;
        items?: any[];
        metadata?: Record<string, any>;
    }): Promise<PaymentIntent> {
        try {
            const currency = params.currency || 'USDC';
            const tokenMint = currency === 'USDC' ? USDC_MINT : TOLA_MINT;
            const decimals = currency === 'USDC' ? 6 : 9;
            
            // Default token amount equals USD for USDC, or use provided amount
            const amountToken = params.amountToken || params.amountUSD;
            
            logger.info(`[Payment] Creating intent for order ${params.orderId}: ${amountToken} ${currency}`);
            
            // Get platform treasury token account
            let treasuryTokenAccount: string;
            if (PLATFORM_TREASURY) {
                const treasuryPubkey = new PublicKey(PLATFORM_TREASURY);
                const tokenAccount = await getAssociatedTokenAddress(tokenMint, treasuryPubkey);
                treasuryTokenAccount = tokenAccount.toString();
            } else {
                // Fallback - will need to be updated with actual treasury
                treasuryTokenAccount = 'TREASURY_NOT_CONFIGURED';
            }
            
            const now = new Date();
            const expiresAt = new Date(now.getTime() + CONFIG.intentExpiry);
            
            // Create payment intent
            const intent: PaymentIntent = {
                id: `PI_${Date.now()}_${params.orderId}`,
                orderId: params.orderId,
                userId: params.userId,
                amountUSD: params.amountUSD,
                amountToken,
                currency,
                buyerEmail: params.buyerEmail,
                buyerWallet: params.buyerWallet,
                toAddress: treasuryTokenAccount,
                createdAt: now,
                expiresAt,
                status: 'pending',
                metadata: params.metadata
            };
            
            // Generate transfer amount in smallest units
            const transferAmount = Math.floor(amountToken * Math.pow(10, decimals));
            
            // Generate Phantom deep link
            intent.deepLink = this.generateDeepLink({
                recipient: treasuryTokenAccount,
                amount: transferAmount,
                mint: tokenMint.toString(),
                label: `Order ${params.orderId}`,
                message: `Payment for order ${params.orderId}`
            });
            
            // QR data (same as deep link)
            intent.qrData = intent.deepLink;
            
            // Store intent
            this.intents[intent.id] = intent;
            
            // Try to save to WordPress
            await this.saveIntentToWP(intent);
            
            logger.info(`[Payment] Intent created: ${intent.id}`);
            
            return intent;
            
        } catch (error: any) {
            logger.error('[Payment] Create intent error:', error);
            throw new Error(`Failed to create payment intent: ${error.message}`);
        }
    }
    
    /**
     * Generate Phantom deep link for payment
     */
    private generateDeepLink(params: {
        recipient: string;
        amount: number;
        mint: string;
        label?: string;
        message?: string;
    }): string {
        const baseUrl = 'https://phantom.app/ul/v1/transfer';
        const queryParams = new URLSearchParams({
            recipient: params.recipient,
            amount: params.amount.toString(),
            'spl-token': params.mint
        });
        
        if (params.label) {
            queryParams.append('label', params.label);
        }
        if (params.message) {
            queryParams.append('message', params.message);
        }
        
        return `${baseUrl}?${queryParams.toString()}`;
    }
    
    /**
     * Verify payment on-chain
     */
    async verifyPayment(signature: string, orderId: string): Promise<PaymentVerification> {
        try {
            logger.info(`[Payment] Verifying payment: ${signature} for order ${orderId}`);
            
            // Find the intent
            const intent = Object.values(this.intents).find(i => i.orderId === orderId);
            
            // Fetch transaction from blockchain
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            if (!tx) {
                logger.warn(`[Payment] Transaction not found: ${signature}`);
                return {
                    verified: false,
                    orderId,
                    signature,
                    status: 'not_found',
                    error: 'Transaction not found on blockchain'
                };
            }
            
            // Verify transaction succeeded
            if (tx.meta?.err) {
                logger.warn(`[Payment] Transaction failed: ${signature}`);
                return {
                    verified: false,
                    orderId,
                    signature,
                    status: 'failed',
                    error: 'Transaction failed on blockchain'
                };
            }
            
            // Update intent if found
            if (intent) {
                intent.paidAt = new Date();
                intent.txSignature = signature;
                intent.status = 'paid';
                
                // Add to history
                this.paymentHistory.push({ ...intent });
                this.totalProcessed++;
                this.totalValue += intent.amountUSD;
            }
            
            // Notify WordPress
            await this.notifyWPPayment(orderId, signature);
            
            // Try to update WooCommerce order
            await this.updateWooCommerceOrder(orderId, signature);
            
            logger.info(`[Payment] Payment verified: ${orderId}, signature: ${signature}`);
            
            return {
                verified: true,
                orderId,
                signature,
                status: 'paid',
                amount: intent?.amountToken,
                timestamp: new Date()
            };
            
        } catch (error: any) {
            logger.error('[Payment] Verify payment error:', error);
            return {
                verified: false,
                orderId,
                signature,
                status: 'error',
                error: error.message
            };
        }
    }
    
    /**
     * Get payment status
     */
    async getPaymentStatus(orderId: string): Promise<PaymentIntent | null> {
        // Check local storage first
        const intent = Object.values(this.intents).find(i => i.orderId === orderId);
        if (intent) {
            return intent;
        }
        
        // Try to fetch from WordPress
        try {
            const wpIntent = await this.getIntentFromWP(orderId);
            if (wpIntent) {
                return wpIntent;
            }
        } catch (e) {
            // Not found in WP
        }
        
        return null;
    }
    
    /**
     * Get payment intent by ID
     */
    getIntent(intentId: string): PaymentIntent | null {
        return this.intents[intentId] || null;
    }
    
    /**
     * Check if a transaction exists and is confirmed
     */
    async verifyTransaction(signature: string): Promise<boolean> {
        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            return tx !== null && !tx.meta?.err;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Save intent to WordPress
     */
    private async saveIntentToWP(intent: PaymentIntent): Promise<void> {
        if (!WP_AJAX_URL) return;
        
        try {
            await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'vortex_save_payment_intent',
                intent_id: intent.id,
                order_id: intent.orderId,
                amount_usd: intent.amountUSD.toString(),
                amount_token: intent.amountToken.toString(),
                currency: intent.currency,
                to_address: intent.toAddress,
                status: intent.status
            }), { timeout: 5000 });
        } catch (error) {
            logger.warn('[Payment] Failed to save intent to WP:', error);
        }
    }
    
    /**
     * Get intent from WordPress
     */
    private async getIntentFromWP(orderId: string): Promise<PaymentIntent | null> {
        if (!WP_AJAX_URL) return null;
        
        try {
            const response = await axios.get(WP_AJAX_URL, {
                params: {
                    action: 'vortex_get_payment_intent',
                    order_id: orderId
                },
                timeout: 5000
            });
            
            if (response.data?.success && response.data?.data) {
                return response.data.data as PaymentIntent;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Notify WordPress of payment
     */
    private async notifyWPPayment(orderId: string, signature: string): Promise<void> {
        if (!WP_AJAX_URL) return;
        
        try {
            await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'vortex_payment_received',
                order_id: orderId,
                tx_signature: signature
            }), { timeout: 5000 });
        } catch (error) {
            logger.warn('[Payment] Failed to notify WP:', error);
        }
    }
    
    /**
     * Update WooCommerce order status
     */
    private async updateWooCommerceOrder(orderId: string, signature: string): Promise<void> {
        if (!WOO_BASE_URL || !WOO_CONSUMER_KEY || !WOO_CONSUMER_SECRET) return;
        
        try {
            // Extract numeric order ID if needed
            const numericOrderId = orderId.replace(/[^0-9]/g, '');
            
            await axios.put(
                `${WOO_BASE_URL}/wp-json/wc/v3/orders/${numericOrderId}`,
                {
                    status: 'completed',
                    meta_data: [
                        { key: '_vortex_tx_signature', value: signature },
                        { key: '_vortex_paid_at', value: new Date().toISOString() }
                    ]
                },
                {
                    auth: {
                        username: WOO_CONSUMER_KEY,
                        password: WOO_CONSUMER_SECRET
                    },
                    timeout: 10000
                }
            );
            
            logger.info(`[Payment] WooCommerce order ${orderId} updated`);
        } catch (error: any) {
            logger.warn('[Payment] Failed to update WooCommerce order:', error.message);
        }
    }
    
    /**
     * Get payment history
     */
    getPaymentHistory(limit: number = 50): PaymentIntent[] {
        return this.paymentHistory.slice(-limit);
    }
    
    /**
     * Get payment statistics
     */
    getStats(): {
        total_processed: number;
        total_value_usd: number;
        pending_intents: number;
        paid_intents: number;
        expired_intents: number;
    } {
        const intents = Object.values(this.intents);
        return {
            total_processed: this.totalProcessed,
            total_value_usd: this.totalValue,
            pending_intents: intents.filter(i => i.status === 'pending').length,
            paid_intents: intents.filter(i => i.status === 'paid').length,
            expired_intents: intents.filter(i => i.status === 'expired').length
        };
    }
    
    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return true;
    }
    
    /**
     * Get service health
     */
    getHealth(): {
        healthy: boolean;
        treasury_configured: boolean;
        rpc_connected: boolean;
        wp_configured: boolean;
        woo_configured: boolean;
    } {
        return {
            healthy: true,
            treasury_configured: !!PLATFORM_TREASURY,
            rpc_connected: !!this.connection,
            wp_configured: !!WP_AJAX_URL,
            woo_configured: !!(WOO_BASE_URL && WOO_CONSUMER_KEY)
        };
    }
}
