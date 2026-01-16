/**
 * Assets Routes - Daily Platform Assets & Bundles
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { DailyAssetService } from '../services/daily-asset.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

// Initialize service with error handling
let dailyAssetService: DailyAssetService | null = null;
try {
    dailyAssetService = new DailyAssetService();
    console.log('[ASSETS Routes] DailyAssetService initialized');
} catch (error: any) {
    console.error('[ASSETS Routes] DailyAssetService failed:', error.message);
}

/**
 * GET /api/assets/daily
 * Get daily assets summary
 * @version 4.0.0
 */
router.get('/daily', async (req: Request, res: Response) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Return summary even if service unavailable
        if (!dailyAssetService) {
            return res.json({
                success: true,
                date: today,
                version: '4.0.0',
                data: {
                    total_assets: 0,
                    new_today: 0,
                    status: 'service_initializing'
                },
                timestamp: new Date().toISOString()
            });
        }
        
        const todayBundle = await dailyAssetService.getTodayBundle();
        
        res.json({
            success: true,
            date: today,
            version: '4.0.0',
            data: todayBundle || {
                total_assets: 0,
                new_today: 0,
                status: 'no_bundle_today'
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[ASSETS] Daily summary error:', error);
        res.json({
            success: true,
            date: new Date().toISOString().split('T')[0],
            version: '4.0.0',
            data: {
                total_assets: 0,
                new_today: 0,
                status: 'error'
            },
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /assets/daily/create
 * Create today's grouped daily platform asset (admin only)
 */
router.post('/daily/create', authMiddleware, async (req: Request, res: Response) => {
    try {
        if (!dailyAssetService) {
            return res.status(503).json({
                success: false,
                error: 'Asset service not available'
            });
        }
        
        logger.info('[ASSETS] Creating daily platform asset...');
        
        const dailyAsset = await dailyAssetService.createDailyBundle();
        
        res.json({
            success: true,
            message: 'Daily platform asset created successfully',
            data: dailyAsset
        });
        
    } catch (error) {
        logger.error('[ASSETS] Daily asset creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create daily asset',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /assets/daily/today
 * Get today's daily asset bundle
 */
router.get('/daily/today', async (req: Request, res: Response) => {
    try {
        if (!dailyAssetService) {
            return res.status(503).json({
                success: false,
                error: 'Asset service not available'
            });
        }
        
        const todayAsset = await dailyAssetService.getTodayBundle();
        
        res.json({
            success: true,
            data: todayAsset || null
        });
        
    } catch (error) {
        logger.error('[ASSETS] Get today asset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get today asset',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /assets/products
 * List all products with their NFT status
 */
router.get('/products', async (req: Request, res: Response) => {
    try {
        if (!dailyAssetService) {
            return res.status(503).json({
                success: false,
                error: 'Asset service not available'
            });
        }
        
        const products = await dailyAssetService.getProductsWithNFTs();
        
        res.json({
            success: true,
            data: products,
            count: products.length
        });
        
    } catch (error) {
        logger.error('[ASSETS] Get products error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get products',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export { router as assetsRoutes };

