/**
 * USDC Routes
 * API endpoints for USDC token transfers
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { USDCTransferService, USDCTransferRequest } from '../services/usdc-transfer.service';

const router = Router();

// Initialize service with error handling
let usdcService: USDCTransferService | null = null;
try {
    usdcService = new USDCTransferService();
    console.log('[USDC Routes] Service initialized');
} catch (error: any) {
    console.error('[USDC Routes] Service initialization failed:', error.message);
}

/**
 * POST /api/usdc/transfer
 * Transfer USDC to user wallet
 */
router.post('/transfer', async (req: Request, res: Response) => {
    try {
        if (!usdcService) {
            return res.status(503).json({
                success: false,
                error: 'USDC service not available'
            });
        }

        const body = req.body as USDCTransferRequest;
        
        if (!body.user_id || !body.wallet_address || !body.amount_usdc) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: user_id, wallet_address, amount_usdc'
            });
        }
        
        const result = await usdcService.transferUSDC(body);
        
        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }
        
    } catch (error: any) {
        console.error('[USDC API] Transfer error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * GET /api/usdc/balance/:wallet
 * Get USDC balance for wallet
 */
router.get('/balance/:wallet', async (req: Request, res: Response) => {
    try {
        if (!usdcService) {
            return res.status(503).json({
                success: false,
                error: 'USDC service not available'
            });
        }

        const { wallet } = req.params;
        
        if (!wallet) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address required'
            });
        }
        
        const balance = await usdcService.getBalance(wallet);
        
        return res.status(200).json({
            success: true,
            wallet,
            balance,
            currency: 'USDC'
        });
        
    } catch (error: any) {
        console.error('[USDC API] Balance error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * GET /api/usdc/verify/:signature
 * Verify transaction signature
 */
router.get('/verify/:signature', async (req: Request, res: Response) => {
    try {
        if (!usdcService) {
            return res.status(503).json({
                success: false,
                error: 'USDC service not available'
            });
        }

        const { signature } = req.params;
        
        if (!signature) {
            return res.status(400).json({
                success: false,
                error: 'Transaction signature required'
            });
        }
        
        const verified = await usdcService.verifyTransaction(signature);
        
        return res.status(200).json({
            success: true,
            signature,
            verified,
            explorer_url: `https://solscan.io/tx/${signature}`
        });
        
    } catch (error: any) {
        console.error('[USDC API] Verify error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

export default router;
export { router as usdcRoutes };
