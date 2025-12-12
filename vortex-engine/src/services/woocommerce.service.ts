/**
 * WooCommerce Service - REST API Integration
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const WOO_BASE_URL = process.env.WOO_BASE_URL || '';
const WOO_KEY = process.env.WOO_CONSUMER_KEY || '';
const WOO_SECRET = process.env.WOO_CONSUMER_SECRET || '';

export class WooCommerceService {
    
    private apiUrl: string;
    private auth: { username: string; password: string };
    
    constructor() {
        this.apiUrl = `${WOO_BASE_URL}/wp-json/wc/v3`;
        this.auth = {
            username: WOO_KEY,
            password: WOO_SECRET
        };
    }
    
    /**
     * Update product meta fields
     */
    async updateProductMeta(productId: number, meta: {
        vortex_nft_mint?: string;
        vortex_mint_tx?: string;
        vortex_asset_id?: string;
        vortex_on_chain_uri?: string;
    }): Promise<boolean> {
        try {
            logger.info(`[WOO] Updating product ${productId} meta...`);
            
            const metaData = Object.entries(meta).map(([key, value]) => ({
                key,
                value
            }));
            
            const response = await axios.put(
                `${this.apiUrl}/products/${productId}`,
                { meta_data: metaData },
                { auth: this.auth }
            );
            
            logger.info(`[WOO] Product ${productId} meta updated`);
            return true;
            
        } catch (error) {
            logger.error('[WOO] Update meta error:', error);
            throw error;
        }
    }
    
    /**
     * Get product by ID
     */
    async getProduct(productId: number): Promise<any> {
        try {
            const response = await axios.get(
                `${this.apiUrl}/products/${productId}`,
                { auth: this.auth }
            );
            
            return response.data;
        } catch (error) {
            logger.error('[WOO] Get product error:', error);
            throw error;
        }
    }
    
    /**
     * Get products published today
     */
    async getTodayProducts(): Promise<any[]> {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const response = await axios.get(
                `${this.apiUrl}/products`,
                {
                    auth: this.auth,
                    params: {
                        after: today.toISOString(),
                        status: 'publish',
                        per_page: 100
                    }
                }
            );
            
            return response.data;
        } catch (error) {
            logger.error('[WOO] Get today products error:', error);
            throw error;
        }
    }
    
    /**
     * Mark order as completed
     */
    async completeOrder(orderId: string, data: {
        transactionId: string;
        paidAt: string;
        solscanLink: string;
    }): Promise<boolean> {
        try {
            logger.info(`[WOO] Completing order ${orderId}...`);
            
            // Update order status
            await axios.put(
                `${this.apiUrl}/orders/${orderId}`,
                {
                    status: 'processing',
                    transaction_id: data.transactionId,
                    meta_data: [
                        { key: 'vortex_payment_signature', value: data.transactionId },
                        { key: 'vortex_paid_at', value: data.paidAt },
                        { key: 'vortex_solscan_link', value: data.solscanLink }
                    ]
                },
                { auth: this.auth }
            );
            
            logger.info(`[WOO] Order ${orderId} marked as paid`);
            return true;
            
        } catch (error) {
            logger.error('[WOO] Complete order error:', error);
            throw error;
        }
    }
    
    /**
     * Mark order as paid (alias for completeOrder)
     */
    async markOrderPaid(orderId: string, signature: string): Promise<boolean> {
        return this.completeOrder(orderId, {
            transactionId: signature,
            paidAt: new Date().toISOString(),
            solscanLink: `https://solscan.io/tx/${signature}`
        });
    }
    
    /**
     * Get order by ID
     */
    async getOrder(orderId: string): Promise<any> {
        try {
            const response = await axios.get(
                `${this.apiUrl}/orders/${orderId}`,
                { auth: this.auth }
            );
            
            return response.data;
        } catch (error) {
            logger.error('[WOO] Get order error:', error);
            throw error;
        }
    }
}

