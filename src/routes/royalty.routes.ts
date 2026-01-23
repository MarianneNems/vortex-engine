/**
 * Royalty Routes v4.0.0
 * 
 * IMMUTABLE 5% Royalty Enforcement API
 * 
 * Endpoints for:
 * - Platform royalty configuration (read-only)
 * - Royalty verification for mints
 * - Secondary sale royalty processing
 * - Royalty collection and distribution
 * - HURAII signature verification
 * 
 * SECURITY NOTICE:
 * The 5% royalty rate is PERMANENTLY LOCKED and cannot be changed.
 * All endpoints enforce this immutable rate.
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { authMiddleware } from '../middleware/auth.middleware';
import { getRoyaltyService, ROYALTY_CONFIG } from '../services/royalty.service';

const router = Router();

// ============================================
// IMMUTABLE ROYALTY CONFIGURATION
// ============================================

/**
 * GET /api/royalty/config
 * Get the IMMUTABLE royalty configuration
 * 
 * This configuration CANNOT be changed:
 * - Rate: 5% (0.05)
 * - BPS: 500
 * - Wallet: 6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g
 */
router.get('/config', async (req: Request, res: Response) => {
    try {
        const service = getRoyaltyService();
        const config = service.getConfig();
        
        res.json({
            success: true,
            data: {
                royalty_rate: config.PLATFORM_ROYALTY_RATE,
                royalty_bps: config.PLATFORM_ROYALTY_BPS,
                royalty_percent: `${config.PLATFORM_ROYALTY_RATE * 100}%`,
                royalty_wallet: config.PLATFORM_ROYALTY_WALLET,
                immutable: config.IMMUTABLE,
                can_be_changed: config.CAN_BE_CHANGED,
                can_be_lowered: config.CAN_BE_LOWERED,
                can_be_removed: config.CAN_BE_REMOVED,
                locked_date: config.LOCKED_DATE,
                creator: config.CREATOR,
                version: config.VERSION
            },
            message: 'This configuration is IMMUTABLE and cannot be changed',
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Config error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/royalty/rates
 * Get current royalty rates (IMMUTABLE)
 */
router.get('/rates', async (req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            platform_royalty: {
                rate: 0.05,
                bps: 500,
                percent: '5%',
                immutable: true,
                description: 'Platform royalty on all HURAII-generated NFTs'
            },
            primary_sale: {
                artist: 85,
                platform: 15,
                description: 'First sale distribution'
            },
            secondary_sale: {
                total_royalty_bps: 2000,
                platform_share: 500,
                artist_share: 1500,
                description: 'Secondary sale royalty split'
            },
            marketplace_fee: {
                percent: 15,
                description: 'Platform marketplace commission'
            }
        },
        notice: 'Platform royalty (5%) is IMMUTABLE and cannot be changed',
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ROYALTY VERIFICATION
// ============================================

/**
 * GET /api/royalty/verify/:mint
 * Verify royalty configuration for a mint
 */
router.get('/verify/:mint', async (req: Request, res: Response) => {
    try {
        const { mint } = req.params;
        const service = getRoyaltyService();
        
        const verification = await service.verifyMintRoyalty(mint);
        
        res.json({
            success: true,
            data: verification,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Verify error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/royalty/verify-huraii
 * Verify HURAII signature on an image
 */
router.post('/verify-huraii', async (req: Request, res: Response) => {
    try {
        const { attachment_id, signature_hash, image_url } = req.body;
        const service = getRoyaltyService();
        
        const verification = await service.verifyHURAIISignature(attachment_id, signature_hash);
        
        res.json({
            success: true,
            data: {
                attachment_id,
                ...verification,
                royalty_wallet: service.getRoyaltyWallet(),
                message: verification.huraii_authentic 
                    ? 'Image is authentic HURAII generation - 5% royalty enforced'
                    : 'Image signature could not be verified'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Verify HURAII error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// MINT RECORDING
// ============================================

/**
 * POST /api/royalty/record-mint
 * Record a new mint with IMMUTABLE royalty
 */
router.post('/record-mint', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { mint_address, user_id, seller_fee_basis_points, creators, huraii_signature } = req.body;
        
        if (!mint_address || !user_id) {
            return res.status(400).json({
                success: false,
                error: 'mint_address and user_id are required'
            });
        }
        
        const service = getRoyaltyService();
        const result = await service.recordMint({
            mint_address,
            user_id,
            seller_fee_basis_points: seller_fee_basis_points || 500, // Default to 5%
            creators: creators || [],
            huraii_signature
        });
        
        res.status(result.success ? 201 : 400).json({
            ...result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Record mint error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// SECONDARY SALE PROCESSING
// ============================================

/**
 * POST /api/royalty/sale
 * Process a secondary sale
 */
router.post('/sale', async (req: Request, res: Response) => {
    try {
        const { mint_address, sale_signature, sale_amount, buyer, seller } = req.body;
        
        if (!mint_address || !sale_signature || !sale_amount) {
            return res.status(400).json({
                success: false,
                error: 'mint_address, sale_signature, and sale_amount are required'
            });
        }
        
        const service = getRoyaltyService();
        const payment = await service.processSecondarySale(
            mint_address,
            sale_signature,
            parseFloat(sale_amount),
            buyer,
            seller
        );
        
        res.status(201).json({
            success: true,
            data: payment,
            message: `5% royalty (${payment.royalty_amount} USDC) recorded for collection`,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Sale error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/royalty/collect
 * Collect pending royalty payment
 */
router.post('/collect', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { payment_id, mint_address, sale_signature, amount, wallet } = req.body;
        
        const service = getRoyaltyService();
        
        // If payment_id provided, collect specific payment
        if (payment_id) {
            const result = await service.collectRoyalty(payment_id);
            
            return res.json({
                success: result.success,
                data: result,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        // Otherwise, process as new sale and collect
        if (!mint_address || !sale_signature || !amount) {
            return res.status(400).json({
                success: false,
                error: 'payment_id or (mint_address, sale_signature, amount) required'
            });
        }
        
        const payment = await service.processSecondarySale(
            mint_address,
            sale_signature,
            parseFloat(amount),
            '',
            ''
        );
        
        const collection = await service.collectRoyalty(payment.id);
        
        res.json({
            success: collection.success,
            data: {
                payment,
                collection
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Collect error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/royalty/distribute
 * Distribute royalty from a sale
 */
router.post('/distribute', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { mint_address, sale_amount, recipients, payment_id, amount, recipient } = req.body;
        
        const service = getRoyaltyService();
        
        // Handle different payload formats from WordPress
        const actualMint = mint_address || payment_id;
        const actualAmount = parseFloat(sale_amount || amount || '0');
        const actualRecipients = recipients || [{ address: recipient, share: 100 }];
        
        if (!actualMint || !actualAmount) {
            return res.status(400).json({
                success: false,
                error: 'mint_address and sale_amount are required'
            });
        }
        
        const result = await service.distributeRoyalty(
            actualMint,
            actualAmount,
            actualRecipients
        );
        
        res.json({
            success: result.success,
            data: result.distributions,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Distribute error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// ARTIST ROYALTY ENDPOINTS
// ============================================

/**
 * GET /api/royalty/earnings/:artist_id
 * Get artist royalty earnings
 */
router.get('/earnings/:artist_id', async (req: Request, res: Response) => {
    try {
        const { artist_id } = req.params;
        const { period = '30d' } = req.query;
        
        const service = getRoyaltyService();
        
        res.json({
            success: true,
            data: {
                artist_id: parseInt(artist_id),
                period,
                total_earnings_usdc: 0,
                pending_payout: 0,
                paid_out: 0,
                sales_count: 0,
                platform_royalty_rate: service.getRoyaltyRate(),
                breakdown: {
                    primary_sales: 0,
                    secondary_sales: 0,
                    subscription_share: 0
                }
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Earnings error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/royalty/history/:artist_id
 * Get royalty payment history
 */
router.get('/history/:artist_id', async (req: Request, res: Response) => {
    try {
        const { artist_id } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        res.json({
            success: true,
            data: {
                artist_id: parseInt(artist_id),
                payments: [],
                total: 0,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string)
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] History error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/royalty/request-payout
 * Request royalty payout
 */
router.post('/request-payout', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { artist_id, wallet_address, amount_usdc } = req.body;
        
        if (!artist_id || !wallet_address) {
            return res.status(400).json({
                success: false,
                error: 'Missing artist_id or wallet_address'
            });
        }
        
        logger.info(`[ROYALTY] Payout request: artist ${artist_id}, ${amount_usdc} USDC`);
        
        res.json({
            success: true,
            data: {
                payout_id: `PAYOUT_${Date.now()}`,
                artist_id,
                wallet_address,
                amount_usdc: amount_usdc || 0,
                status: 'pending',
                requested_at: new Date().toISOString()
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Payout request error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// STATISTICS & HEALTH
// ============================================

/**
 * GET /api/royalty/stats
 * Get royalty statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const service = getRoyaltyService();
        const stats = service.getStats();
        
        res.json({
            success: true,
            data: stats,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/royalty/pending
 * Get pending royalty payments
 */
router.get('/pending', authMiddleware, async (req: Request, res: Response) => {
    try {
        const service = getRoyaltyService();
        const pending = service.getPendingPayments();
        
        res.json({
            success: true,
            data: {
                count: pending.length,
                payments: pending,
                total_pending: pending.reduce((sum, p) => sum + p.royalty_amount, 0)
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[ROYALTY] Pending error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/royalty/health
 * Royalty service health check
 */
router.get('/health', async (req: Request, res: Response) => {
    try {
        const service = getRoyaltyService();
        const health = await service.getHealth();
        
        res.json({
            success: true,
            service: 'royalty',
            ...health,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        res.status(503).json({
            success: false,
            service: 'royalty',
            healthy: false,
            error: error.message
        });
    }
});

// ============================================
// WEBHOOK ENDPOINT FOR SECONDARY SALES
// ============================================

/**
 * POST /api/royalty/webhook/sale
 * Webhook for secondary sale notifications (from indexers like Helius)
 */
router.post('/webhook/sale', async (req: Request, res: Response) => {
    try {
        const { type, nft, signature, amount, buyer, seller, source } = req.body;
        
        logger.info(`[ROYALTY WEBHOOK] ${type}: ${nft?.mint || 'unknown'}`);
        
        if (type === 'NFT_SALE' && nft?.mint) {
            const service = getRoyaltyService();
            
            const payment = await service.processSecondarySale(
                nft.mint,
                signature,
                parseFloat(amount || '0'),
                buyer,
                seller
            );
            
            return res.json({
                success: true,
                message: 'Sale processed',
                data: {
                    payment_id: payment.id,
                    royalty_amount: payment.royalty_amount
                }
            });
        }
        
        res.json({ success: true, message: 'Webhook received' });
        
    } catch (error: any) {
        logger.error('[ROYALTY WEBHOOK] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
