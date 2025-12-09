/**
 * Assets Routes - Daily Platform Assets & Bundles
 */

import { Router, Request, Response } from 'express';
import { DailyAssetService } from '../services/daily-asset.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();
const dailyAssetService = new DailyAssetService();

/**
 * POST /assets/daily/create
 * Create today's grouped daily platform asset (admin only)
 */
router.post('/daily/create', authMiddleware, async (req: Request, res: Response) => {
    try {
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

