/**
 * Webhook Processor Service - Production Grade
 * Handles incoming webhooks with business logic integration
 * 
 * Features:
 * - Event processing for all webhook types
 * - Service integration (NFT, USDC, TOLA)
 * - Event logging and auditing
 * - Retry logic for failed operations
 * - Queue management
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { logger } from '../utils/logger';

// Event types
export type WebhookEventType = 
    | 'product.published'
    | 'order.created'
    | 'order.paid'
    | 'wallet.connected'
    | 'tola.transaction'
    | 'subscription.activated'
    | 'usage.payment'
    | 'stripe.purchase'
    | 'balance.spent'
    | 'balance.sync'
    | 'nft.minted'
    | 'generation.completed'
    | 'style.transfer'
    | 'artwork.saved'
    | 'collector.subscription'
    | 'product.listed'
    | 'huraii.vision'
    | 'style.generation';

export interface WebhookEvent {
    id: string;
    type: WebhookEventType;
    timestamp: Date;
    data: any;
    processed: boolean;
    result?: any;
    error?: string;
    retries: number;
}

export interface ProcessResult {
    success: boolean;
    action_taken?: string;
    data?: any;
    error?: string;
}

type EventHandler = (event: WebhookEvent) => Promise<ProcessResult>;

export class WebhookProcessorService {
    private eventLog: WebhookEvent[] = [];
    private handlers: Map<WebhookEventType, EventHandler> = new Map();
    private processingQueue: WebhookEvent[] = [];
    private isProcessing: boolean = false;
    private maxRetries: number = 3;
    private services: {
        usdc?: any;
        tola?: any;
        nft?: any;
        payment?: any;
    } = {};

    constructor() {
        this.registerDefaultHandlers();
        logger.info('[Webhook Processor] Initialized');
    }

    /**
     * Set service references for integration
     */
    setServices(services: {
        usdc?: any;
        tola?: any;
        nft?: any;
        payment?: any;
    }): void {
        this.services = services;
        logger.info('[Webhook Processor] Services configured');
    }

    /**
     * Register default event handlers
     */
    private registerDefaultHandlers(): void {
        // Product published - could trigger NFT minting
        this.handlers.set('product.published', async (event) => {
            const { product } = event.data;
            logger.info(`[Webhook] Product published: ${product?.id}`);
            
            // Check if product should be auto-minted as NFT
            if (product?.meta_data?.auto_mint_nft && this.services.nft) {
                try {
                    const result = await this.services.nft.mintNFT({
                        name: product.name,
                        uri: product.meta_data.nft_uri || product.images?.[0]?.src,
                        description: product.description,
                        recipient: product.meta_data.artist_wallet
                    });
                    
                    return {
                        success: true,
                        action_taken: 'nft_minted',
                        data: { mint_address: result.mint_address }
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }
            
            return { success: true, action_taken: 'logged' };
        });

        // Order paid - process payment and distribute TOLA rewards
        this.handlers.set('order.paid', async (event) => {
            const { order, payment } = event.data;
            logger.info(`[Webhook] Order paid: ${order?.id}, amount: ${payment?.amount}`);
            
            // Distribute TOLA incentive if configured
            if (order?.customer?.wallet_address && this.services.tola) {
                const tolaReward = (payment?.amount || 0) * 0.01; // 1% cashback in TOLA
                
                if (tolaReward > 0) {
                    try {
                        const result = await this.services.tola.transferTOLA({
                            user_id: order.customer.id,
                            wallet_address: order.customer.wallet_address,
                            amount_tola: tolaReward,
                            reason: 'reward'
                        });
                        
                        return {
                            success: true,
                            action_taken: 'tola_reward_sent',
                            data: { amount: tolaReward, signature: result.signature }
                        };
                    } catch (e: any) {
                        logger.error('[Webhook] TOLA reward failed:', e.message);
                    }
                }
            }
            
            return { success: true, action_taken: 'logged' };
        });

        // Wallet connected - sync balances
        this.handlers.set('wallet.connected', async (event) => {
            const { user, wallet } = event.data;
            logger.info(`[Webhook] Wallet connected: user ${user?.id}, wallet ${wallet?.address}`);
            
            // Trigger balance sync
            if (wallet?.address && this.services.usdc) {
                try {
                    const usdcBalance = await this.services.usdc.getBalance(wallet.address);
                    const tolaBalance = this.services.tola 
                        ? await this.services.tola.getBalance(wallet.address) 
                        : 0;
                    
                    return {
                        success: true,
                        action_taken: 'balance_synced',
                        data: { usdc: usdcBalance, tola: tolaBalance }
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }
            
            return { success: true, action_taken: 'logged' };
        });

        // Stripe purchase completed - credit USDC balance
        this.handlers.set('stripe.purchase', async (event) => {
            const { user, payment } = event.data;
            logger.info(`[Webhook] Stripe purchase: user ${user?.id}, amount ${payment?.amount}`);
            
            // Transfer USDC to user wallet
            if (user?.wallet_address && payment?.amount && this.services.usdc) {
                try {
                    const result = await this.services.usdc.transferUSDC({
                        user_id: user.id,
                        wallet_address: user.wallet_address,
                        amount_usdc: payment.amount,
                        order_id: payment.intent_id
                    });
                    
                    return {
                        success: true,
                        action_taken: 'usdc_credited',
                        data: { signature: result.signature }
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }
            
            return { success: true, action_taken: 'logged' };
        });

        // NFT minted - update product metadata
        this.handlers.set('nft.minted', async (event) => {
            const { user, nft } = event.data;
            logger.info(`[Webhook] NFT minted: ${nft?.mint_address} for user ${user?.id}`);
            
            return {
                success: true,
                action_taken: 'logged',
                data: { mint_address: nft?.mint_address }
            };
        });

        // Balance spent - log usage
        this.handlers.set('balance.spent', async (event) => {
            const { user, amount, reason, balance_after } = event.data;
            logger.info(`[Webhook] Balance spent: user ${user?.id}, amount ${amount}, reason: ${reason}`);
            
            return {
                success: true,
                action_taken: 'logged',
                data: { amount, reason, balance_after }
            };
        });

        // Generation completed - could mint as NFT
        this.handlers.set('generation.completed', async (event) => {
            const { user, generation } = event.data;
            logger.info(`[Webhook] Generation completed: ${generation?.id} by user ${user?.id}`);
            
            return {
                success: true,
                action_taken: 'logged',
                data: { generation_id: generation?.id }
            };
        });

        // Default handler for other events
        const defaultHandler: EventHandler = async (event) => {
            logger.info(`[Webhook] Event ${event.type}: ${JSON.stringify(event.data).slice(0, 200)}`);
            return { success: true, action_taken: 'logged' };
        };

        // Register default for unhandled types
        [
            'order.created',
            'tola.transaction',
            'subscription.activated',
            'usage.payment',
            'balance.sync',
            'style.transfer',
            'artwork.saved',
            'collector.subscription',
            'product.listed',
            'huraii.vision',
            'style.generation'
        ].forEach(type => {
            if (!this.handlers.has(type as WebhookEventType)) {
                this.handlers.set(type as WebhookEventType, defaultHandler);
            }
        });
    }

    /**
     * Process incoming webhook
     */
    async processWebhook(type: WebhookEventType, data: any): Promise<ProcessResult> {
        const event: WebhookEvent = {
            id: `WH_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type,
            timestamp: new Date(),
            data,
            processed: false,
            retries: 0
        };

        this.eventLog.push(event);

        // Keep log bounded
        if (this.eventLog.length > 1000) {
            this.eventLog = this.eventLog.slice(-1000);
        }

        try {
            const handler = this.handlers.get(type);
            
            if (!handler) {
                logger.warn(`[Webhook] No handler for event type: ${type}`);
                return { success: true, action_taken: 'no_handler' };
            }

            const result = await handler(event);
            
            event.processed = true;
            event.result = result;
            
            return result;

        } catch (error: any) {
            event.error = error.message;
            logger.error(`[Webhook] Error processing ${type}:`, error);
            
            // Queue for retry
            if (event.retries < this.maxRetries) {
                event.retries++;
                this.processingQueue.push(event);
                this.processQueue();
            }
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Process queued events
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.processingQueue.length > 0) {
            const event = this.processingQueue.shift();
            if (!event) continue;

            // Wait before retry
            await new Promise(r => setTimeout(r, 1000 * event.retries));

            try {
                const handler = this.handlers.get(event.type);
                if (handler) {
                    const result = await handler(event);
                    event.processed = true;
                    event.result = result;
                }
            } catch (error: any) {
                event.error = error.message;
                
                if (event.retries < this.maxRetries) {
                    event.retries++;
                    this.processingQueue.push(event);
                }
            }
        }

        this.isProcessing = false;
    }

    /**
     * Register custom handler
     */
    registerHandler(type: WebhookEventType, handler: EventHandler): void {
        this.handlers.set(type, handler);
        logger.info(`[Webhook] Registered handler for: ${type}`);
    }

    /**
     * Get event log
     */
    getEventLog(limit: number = 50): WebhookEvent[] {
        return this.eventLog.slice(-limit);
    }

    /**
     * Get events by type
     */
    getEventsByType(type: WebhookEventType, limit: number = 20): WebhookEvent[] {
        return this.eventLog
            .filter(e => e.type === type)
            .slice(-limit);
    }

    /**
     * Get processing stats
     */
    getStats(): {
        total_events: number;
        processed: number;
        failed: number;
        pending: number;
        by_type: Record<string, number>;
    } {
        const byType: Record<string, number> = {};
        let processed = 0;
        let failed = 0;

        for (const event of this.eventLog) {
            byType[event.type] = (byType[event.type] || 0) + 1;
            if (event.processed) processed++;
            if (event.error) failed++;
        }

        return {
            total_events: this.eventLog.length,
            processed,
            failed,
            pending: this.processingQueue.length,
            by_type: byType
        };
    }

    /**
     * Clear old events
     */
    clearOldEvents(olderThanHours: number = 24): number {
        const cutoff = new Date(Date.now() - olderThanHours * 3600000);
        const before = this.eventLog.length;
        this.eventLog = this.eventLog.filter(e => e.timestamp > cutoff);
        return before - this.eventLog.length;
    }
}

// Export singleton
export const webhookProcessor = new WebhookProcessorService();
