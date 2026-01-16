/**
 * TOLA Routes - Metrics, Quotes, and Payments
 * @version 4.0.0
 * @description TOLA token metrics from Dexscreener and Jupiter swap quotes
 */

import { Router, Request, Response } from 'express';
import { TolaService } from '../services/tola.service';
import { PaymentService } from '../services/payment.service';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services with error handling
let tolaService: TolaService | null = null;
let paymentService: PaymentService | null = null;

try {
    tolaService = new TolaService();
    console.log('[TOLA Routes] TolaService initialized');
} catch (error: any) {
    console.error('[TOLA Routes] TolaService failed:', error.message);
}

try {
    paymentService = new PaymentService();
    console.log('[TOLA Routes] PaymentService initialized');
} catch (error: any) {
    console.error('[TOLA Routes] PaymentService failed:', error.message);
}

/**
 * GET /tola/snapshot
 * Returns current TOLA metrics from Dexscreener
 * @version 4.0.0
 */
router.get('/snapshot', async (req: Request, res: Response) => {
    try {
        logger.info('[TOLA] Fetching snapshot...');
        
        if (tolaService) {
            const snapshot = await tolaService.getSnapshot();
            return res.json({
                success: true,
                data: snapshot,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        // Fallback response
        res.json({
            success: true,
            data: {
                price: 1.00,
                liquidity: 0,
                volume24h: 0,
                baseToken: {
                    address: 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky',
                    name: 'TOLA',
                    symbol: 'TOLA'
                },
                status: 'service_unavailable'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[TOLA] Snapshot error:', error);
        // Return success with fallback data instead of 500
        res.json({
            success: true,
            data: {
                price: 1.00,
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /tola/quote
 * Get swap quote from Jupiter (read-only, no signing)
 * @version 4.0.0
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
        
        if (!tolaService) {
            return res.json({
                success: true,
                data: {
                    inputMint,
                    outputMint,
                    amount,
                    status: 'service_unavailable',
                    message: 'Quote service temporarily unavailable'
                },
                version: '4.0.0',
                timestamp: new Date().toISOString()
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
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[TOLA] Quote error:', error);
        res.json({
            success: true,
            data: {
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /tola/payments/notify
 * Webhook for on-chain payment confirmation
 * @version 4.0.0
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
        
        if (!paymentService) {
            return res.json({
                success: true,
                data: {
                    orderId,
                    status: 'received',
                    message: 'Payment service unavailable, notification logged'
                },
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        const result = await paymentService.verifyPayment(signature, orderId);
        
        res.json({
            success: true,
            data: result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[TOLA] Payment notification error:', error);
        res.json({
            success: true,
            data: {
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /tola/payments/status/:orderId
 * Check payment status for an order
 * @version 4.0.0
 */
router.get('/payments/status/:orderId', async (req: Request, res: Response) => {
    try {
        const { orderId } = req.params;
        
        if (!paymentService) {
            return res.json({
                success: true,
                data: {
                    orderId,
                    status: 'pending',
                    message: 'Payment service unavailable'
                },
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        const status = await paymentService.getPaymentStatus(orderId);
        
        res.json({
            success: true,
            data: status,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[TOLA] Payment status error:', error);
        res.json({
            success: true,
            data: {
                orderId: req.params.orderId,
                status: 'unknown',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    }
});

export { router as tolaRoutes };

