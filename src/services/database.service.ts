/**
 * Database Service - Data persistence layer
 * Uses WordPress database via REST API
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const WP_AJAX_URL = process.env.WP_AJAX_URL || '';
const WP_API_URL = process.env.WP_API_URL || '';

interface ProductAsset {
    id?: number;
    productId: number;
    nftMint: string;
    mintTx: string;
    onChainUri: string;
    owner: string;
    name?: string;
    imageUrl?: string;
    price?: number;
    createdAt: Date;
}

interface DailyBundle {
    day: string;
    bundleMint: string;
    bundleTx: string;
    componentMints: string[];
    sku: string;
    productCount: number;
    totalValue: number;
    createdAt: Date;
}

interface PaymentIntent {
    id: string;
    orderId: string;
    amountUSD: number;
    amountTOLA: number;
    buyerEmail: string;
    toAddress: string;
    createdAt: Date;
    paidAt?: Date;
    txSignature?: string;
    status: string;
    qrData?: string;
    deepLink?: string;
}

export class DatabaseService {
    
    /**
     * Save product asset
     */
    async saveProductAsset(asset: ProductAsset): Promise<number> {
        try {
            const response = await axios.post(`${WP_AJAX_URL}`, new URLSearchParams({
                action: 'vortex_save_product_asset',
                data: JSON.stringify(asset)
            }));
            
            if (response.data.success) {
                return response.data.data.id;
            }
            throw new Error('Failed to save product asset');
            
        } catch (error) {
            logger.error('[DB] Save product asset error:', error);
            throw error;
        }
    }
    
    /**
     * Get product asset
     */
    async getProductAsset(productId: number): Promise<ProductAsset | null> {
        try {
            const response = await axios.get(`${WP_AJAX_URL}?action=vortex_get_product_asset&product_id=${productId}`);
            
            if (response.data.success) {
                return response.data.data;
            }
            return null;
            
        } catch (error) {
            logger.error('[DB] Get product asset error:', error);
            return null;
        }
    }
    
    /**
     * Get today's product assets
     */
    async getTodayProductAssets(): Promise<ProductAsset[]> {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            const response = await axios.get(`${WP_AJAX_URL}?action=vortex_get_today_assets&date=${today}`);
            
            if (response.data.success) {
                return response.data.data || [];
            }
            return [];
            
        } catch (error) {
            logger.error('[DB] Get today assets error:', error);
            return [];
        }
    }
    
    /**
     * Get all product assets
     */
    async getAllProductAssets(): Promise<ProductAsset[]> {
        try {
            const response = await axios.get(`${WP_AJAX_URL}?action=vortex_get_all_product_assets`);
            
            if (response.data.success) {
                return response.data.data || [];
            }
            return [];
            
        } catch (error) {
            logger.error('[DB] Get all assets error:', error);
            return [];
        }
    }
    
    /**
     * Save daily bundle
     */
    async saveDailyBundle(bundle: DailyBundle): Promise<boolean> {
        try {
            const response = await axios.post(`${WP_AJAX_URL}`, new URLSearchParams({
                action: 'vortex_save_daily_bundle',
                data: JSON.stringify(bundle)
            }));
            
            return response.data.success;
            
        } catch (error) {
            logger.error('[DB] Save daily bundle error:', error);
            throw error;
        }
    }
    
    /**
     * Get daily bundle
     */
    async getDailyBundle(day: string): Promise<DailyBundle | null> {
        try {
            const response = await axios.get(`${WP_AJAX_URL}?action=vortex_get_daily_bundle&day=${day}`);
            
            if (response.data.success) {
                return response.data.data;
            }
            return null;
            
        } catch (error) {
            logger.error('[DB] Get daily bundle error:', error);
            return null;
        }
    }
    
    /**
     * Save payment intent
     */
    async savePaymentIntent(intent: PaymentIntent): Promise<boolean> {
        try {
            const response = await axios.post(`${WP_AJAX_URL}`, new URLSearchParams({
                action: 'vortex_save_payment_intent',
                data: JSON.stringify(intent)
            }));
            
            return response.data.success;
            
        } catch (error) {
            logger.error('[DB] Save payment intent error:', error);
            throw error;
        }
    }
    
    /**
     * Get payment intent
     */
    async getPaymentIntent(orderId: string): Promise<PaymentIntent | null> {
        try {
            const response = await axios.get(`${WP_AJAX_URL}?action=vortex_get_payment_intent&order_id=${orderId}`);
            
            if (response.data.success) {
                return response.data.data;
            }
            return null;
            
        } catch (error) {
            logger.error('[DB] Get payment intent error:', error);
            return null;
        }
    }
    
    /**
     * Update payment intent
     */
    async updatePaymentIntent(orderId: string, updates: Partial<PaymentIntent>): Promise<boolean> {
        try {
            const response = await axios.post(`${WP_AJAX_URL}`, new URLSearchParams({
                action: 'vortex_update_payment_intent',
                order_id: orderId,
                updates: JSON.stringify(updates)
            }));
            
            return response.data.success;
            
        } catch (error) {
            logger.error('[DB] Update payment intent error:', error);
            throw error;
        }
    }
}

