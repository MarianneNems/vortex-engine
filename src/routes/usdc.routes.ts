/**
 * USDC Routes
 * API endpoints for USDC token transfers
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { USDCTransferService, USDCTransferRequest } from '../services/usdc-transfer.service';

const usdcService = new USDCTransferService();

export async function usdcRoutes(fastify: FastifyInstance) {
    
    /**
     * POST /api/usdc/transfer
     * Transfer USDC to user wallet
     */
    fastify.post('/api/usdc/transfer', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const body = request.body as USDCTransferRequest;
            
            if (!body.user_id || !body.wallet_address || !body.amount_usdc) {
                return reply.status(400).send({
                    success: false,
                    error: 'Missing required fields'
                });
            }
            
            const result = await usdcService.transferUSDC(body);
            
            if (result.success) {
                return reply.status(200).send(result);
            } else {
                return reply.status(500).send(result);
            }
            
        } catch (error: any) {
            console.error('[USDC API] Transfer error:', error);
            return reply.status(500).send({
                success: false,
                error: error.message || 'Internal server error'
            });
        }
    });
    
    /**
     * GET /api/usdc/balance/:wallet
     * Get USDC balance for wallet
     */
    fastify.get('/api/usdc/balance/:wallet', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { wallet } = request.params as { wallet: string };
            
            if (!wallet) {
                return reply.status(400).send({
                    success: false,
                    error: 'Wallet address required'
                });
            }
            
            const balance = await usdcService.getBalance(wallet);
            
            return reply.status(200).send({
                success: true,
                wallet,
                balance
            });
            
        } catch (error: any) {
            console.error('[USDC API] Balance error:', error);
            return reply.status(500).send({
                success: false,
                error: error.message || 'Internal server error'
            });
        }
    });
    
    /**
     * GET /api/usdc/verify/:signature
     * Verify transaction signature
     */
    fastify.get('/api/usdc/verify/:signature', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { signature } = request.params as { signature: string };
            
            if (!signature) {
                return reply.status(400).send({
                    success: false,
                    error: 'Transaction signature required'
                });
            }
            
            const verified = await usdcService.verifyTransaction(signature);
            
            return reply.status(200).send({
                success: true,
                signature,
                verified
            });
            
        } catch (error: any) {
            console.error('[USDC API] Verify error:', error);
            return reply.status(500).send({
                success: false,
                error: error.message || 'Internal server error'
            });
        }
    });
}

