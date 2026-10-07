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
 *
 * 2026-10-07: reached only after requirePayoutHmac (server.ts) has verified the WordPress server's signature
 * (x-vortex-timestamp, x-vortex-signature over `${timestamp}.${rawBody}`, shared secret WP_RAILWAY_SHARED_SECRET).
 * Body: user_id, wallet_address, amount_usdc (at most 6 decimals), idempotency_key (one per payout), order_id.
 * The same idempotency_key is never paid twice: 409 PAYOUT_DUPLICATE (with the earlier signature) or
 * PAYOUT_IN_PROGRESS; 202 PAYOUT_OUTCOME_UNKNOWN means sent but not yet confirmed: do not pay again.
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
        
        const result = await usdcService.transferUSDC(body, (req as any).vortexSignedPayout);
        
        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(usdcService.statusFor(result)).json(result);
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
 * @version 4.0.0
 */
router.get('/balance/:wallet', async (req: Request, res: Response) => {
    try {
        const { wallet } = req.params;
        
        if (!wallet) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address required'
            });
        }
        
        if (usdcService) {
            const balance = await usdcService.getBalance(wallet);
            return res.json({
                success: true,
                wallet,
                balance,
                currency: 'USDC',
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        // Fallback when service unavailable
        return res.json({
            success: true,
            wallet,
            balance: 0,
            currency: 'USDC',
            status: 'service_unavailable',
            message: 'Balance from WordPress database',
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        console.error('[USDC API] Balance error:', error);
        // Return success with fallback
        return res.json({
            success: true,
            wallet: req.params.wallet,
            balance: 0,
            currency: 'USDC',
            status: 'error',
            version: '4.0.0',
            timestamp: new Date().toISOString()
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
// The router's own service instance (tests replace its RPC connection; nothing else should reach for it).
export { usdcService as usdcTransferService };
