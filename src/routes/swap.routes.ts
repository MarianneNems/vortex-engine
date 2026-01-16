/**
 * Swap Routes
 * Token swap functionality via Jupiter aggregator
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import axios from 'axios';

const router = Router();

const JUP_API = process.env.JUP_API || 'https://quote-api.jup.ag/v6';

/**
 * GET /api/swap/quote
 * Get swap quote from Jupiter
 */
router.get('/quote', async (req: Request, res: Response) => {
    try {
        const { inputMint, outputMint, amount, slippageBps = 100 } = req.query;
        
        if (!inputMint || !outputMint || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: inputMint, outputMint, amount'
            });
        }
        
        logger.info(`[SWAP] Quote request: ${amount} ${inputMint} -> ${outputMint}`);
        
        const response = await axios.get(`${JUP_API}/quote`, {
            params: {
                inputMint,
                outputMint,
                amount,
                slippageBps
            }
        });
        
        res.json({
            success: true,
            data: response.data,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[SWAP] Quote error:', error);
        res.json({
            success: true,
            data: {
                status: 'error',
                message: error.message || 'Failed to get quote'
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/swap/tokens
 * Get list of supported tokens
 */
router.get('/tokens', async (req: Request, res: Response) => {
    try {
        const response = await axios.get(`${JUP_API}/tokens`);
        
        res.json({
            success: true,
            data: response.data,
            count: response.data?.length || 0,
            version: '4.0.0'
        });
        
    } catch (error: any) {
        logger.error('[SWAP] Tokens error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/swap/execute
 * Execute a swap (requires signed transaction)
 */
router.post('/execute', async (req: Request, res: Response) => {
    try {
        const { quote, userPublicKey, wrapUnwrapSOL = true } = req.body;
        
        if (!quote || !userPublicKey) {
            return res.status(400).json({
                success: false,
                error: 'Missing quote or userPublicKey'
            });
        }
        
        logger.info(`[SWAP] Execute request for ${userPublicKey}`);
        
        // Get swap transaction from Jupiter
        const response = await axios.post(`${JUP_API}/swap`, {
            quoteResponse: quote,
            userPublicKey,
            wrapUnwrapSOL
        });
        
        res.json({
            success: true,
            data: {
                swapTransaction: response.data.swapTransaction,
                lastValidBlockHeight: response.data.lastValidBlockHeight
            },
            version: '4.0.0'
        });
        
    } catch (error: any) {
        logger.error('[SWAP] Execute error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
