/**
 * TOLA Routes - Metrics, Quotes, and Payments
 */

import { Router, Request, Response } from 'express';
import { TolaService } from '../services/tola.service';
import { PaymentService } from '../services/payment.service';
import { logger } from '../utils/logger';

const router = Router();
const tolaService = new TolaService();
const paymentService = new PaymentService();

/**
 * GET /tola/snapshot
 * Returns current TOLA metrics from Dexscreener
 */
router.get('/snapshot', async (req: Request, res: Response) => {
    try {
        logger.info('[TOLA] Fetching snapshot...');
        
        const snapshot = await tolaService.getSnapshot();
        
        res.json({
            success: true,
            data: snapshot,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[TOLA] Snapshot error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch TOLA snapshot',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /tola/quote
 * Get swap quote from Jupiter (read-only, no signing)
 */
router.get('/quote', async (req: Request, res: Response) => {
    try {
        const { inputMint, outputMint, amount, slippageBps } = req.query;
        
        if (!inputMint || !outputMint || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: inputMint, outputMint, amount'
            });
        }
        
        logger.info(`[TOLA] Quote request: ${amount} ${inputMint} -> ${outputMint}`);
        
        const quote = await tolaService.getQuote({
            inputMint: inputMint as string,
            outputMint: outputMint as string,
            amount: parseInt(amount as string),
            slippageBps: parseInt(slippageBps as string) || 100
        });
        
        res.json({
            success: true,
            data: quote,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[TOLA] Quote error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get swap quote',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /tola/payments/notify
 * Webhook for on-chain payment confirmation
 */
router.post('/payments/notify', async (req: Request, res: Response) => {
    try {
        const { signature, orderId } = req.body;
        
        if (!signature || !orderId) {
            return res.status(400).json({
                success: false,
                error: 'Missing signature or orderId'
            });
        }
        
        logger.info(`[TOLA] Payment notification for order ${orderId}, sig: ${signature}`);
        
        const result = await paymentService.verifyPayment(signature, orderId);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        logger.error('[TOLA] Payment notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify payment',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /tola/payments/status/:orderId
 * Check payment status for an order
 */
router.get('/payments/status/:orderId', async (req: Request, res: Response) => {
    try {
        const { orderId } = req.params;
        
        const status = await paymentService.getPaymentStatus(orderId);
        
        res.json({
            success: true,
            data: status
        });
        
    } catch (error) {
        logger.error('[TOLA] Payment status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get payment status',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export { router as tolaRoutes };

