/**
 * Payment Service - TOLA Payment Processing
 */

import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { DatabaseService } from './database.service';
import { WooCommerceService } from './woocommerce.service';
import { logger } from '../utils/logger';

const RPC_URL = process.env.RPC_URL || '';
const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_PUBKEY || '';
const TOLA_MINT = new PublicKey(process.env.TOLA_MINT || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky');

interface PaymentIntent {
    id: string;
    orderId: string;
    amountUSD: number;
    amountTOLA: number;
    buyerEmail: string;
    toAddress: string; // Treasury ATA
    createdAt: Date;
    paidAt?: Date;
    txSignature?: string;
    status: 'pending' | 'paid' | 'failed';
    qrData?: string;
    deepLink?: string;
}

export class PaymentService {
    
    private connection: Connection;
    private db: DatabaseService;
    private wooService: WooCommerceService;
    
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        this.db = new DatabaseService();
        this.wooService = new WooCommerceService();
    }
    
    /**
     * Create payment intent
     */
    async createPaymentIntent(params: {
        orderId: string;
        amountUSD: number;
        amountTOLA: number;
        buyerEmail: string;
        items: any[];
    }): Promise<PaymentIntent> {
        try {
            logger.info(`[PAYMENT] Creating intent for order ${params.orderId}: ${params.amountTOLA} TOLA`);
            
            // Get platform treasury TOLA token account
            const treasuryPubkey = new PublicKey(PLATFORM_TREASURY);
            const treasuryTolaAccount = await getAssociatedTokenAddress(
                TOLA_MINT,
                treasuryPubkey
            );
            
            // Create payment intent
            const intent: PaymentIntent = {
                id: `PI_${Date.now()}_${params.orderId}`,
                orderId: params.orderId,
                amountUSD: params.amountUSD,
                amountTOLA: params.amountTOLA,
                buyerEmail: params.buyerEmail,
                toAddress: treasuryTolaAccount.toString(),
                createdAt: new Date(),
                status: 'pending'
            };
            
            // Generate Phantom deep link
            const transferAmount = params.amountTOLA * LAMPORTS_PER_SOL; // Convert to lamports
            intent.deepLink = `https://phantom.app/ul/v1/transfer?recipient=${treasuryTolaAccount.toString()}&amount=${transferAmount}&mint=${TOLA_MINT.toString()}&message=Order ${params.orderId}`;
            
            // QR data (same as deep link)
            intent.qrData = intent.deepLink;
            
            // Save intent to database
            await this.db.savePaymentIntent(intent);
            
            logger.info(`[PAYMENT] Intent created: ${intent.id}`);
            
            return intent;
            
        } catch (error) {
            logger.error('[PAYMENT] Create intent error:', error);
            throw error;
        }
    }
    
    /**
     * Verify payment on-chain
     */
    async verifyPayment(signature: string, orderId: string): Promise<boolean> {
        try {
            logger.info(`[PAYMENT] Verifying payment: ${signature} for order ${orderId}`);
            
            // Fetch transaction from blockchain
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            if (!tx) {
                logger.warn(`[PAYMENT] Transaction not found: ${signature}`);
                return false;
            }
            
            // Verify transaction succeeded
            if (tx.meta?.err) {
                logger.warn(`[PAYMENT] Transaction failed: ${signature}`);
                return false;
            }
            
            // Update payment intent
            await this.db.updatePaymentIntent(orderId, {
                paidAt: new Date(),
                txSignature: signature,
                status: 'paid'
            });
            
            // Notify WooCommerce
            await this.wooService.markOrderPaid(orderId, signature);
            
            logger.info(`[PAYMENT] Payment verified and order marked paid: ${orderId}`);
            
            return true;
            
        } catch (error) {
            logger.error('[PAYMENT] Verify payment error:', error);
            throw error;
        }
    }
    
    /**
     * Verify transaction exists on-chain
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
     * Get payment status
     */
    async getPaymentStatus(orderId: string): Promise<PaymentIntent | null> {
        try {
            const result = await this.db.getPaymentIntent(orderId);
            return result as PaymentIntent | null;
        } catch (error) {
            logger.error('[PAYMENT] Get status error:', error);
            return null;
        }
    }
}

