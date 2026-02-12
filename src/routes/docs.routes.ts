/**
 * API Documentation Routes
 * Self-documenting API endpoints
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';

const router = Router();

const API_DOCS = {
    info: {
        title: 'Vortex Engine API',
        version: '4.0.0',
        description: 'Production-grade Solana blockchain backend for USDC payments, NFT minting, and TOLA incentives',
        contact: {
            name: 'Vortex Platform',
            url: 'https://www.vortexartec.com'
        }
    },
    servers: [
        { url: 'https://vortex-engine-production.up.railway.app', description: 'Production' },
        { url: 'http://localhost:3000', description: 'Development' }
    ],
    authentication: {
        type: 'API Key',
        header: 'x-api-key',
        description: 'Include API key in x-api-key header or Authorization: Bearer <key>'
    },
    endpoints: {
        health: {
            'GET /health': {
                description: 'Service health check',
                auth: false,
                query: { detailed: { type: 'boolean', default: false, description: 'Include detailed service info' } },
                response: {
                    success: 'boolean',
                    status: 'healthy | degraded',
                    version: 'string',
                    services: 'object',
                    uptime: 'number'
                }
            },
            'GET /health/usdc': { description: 'USDC service health', auth: false },
            'GET /health/tola': { description: 'TOLA service health', auth: false },
            'GET /health/nft': { description: 'NFT service health', auth: false },
            'GET /health/assets': { description: 'Daily assets service health', auth: false }
        },
        usdc: {
            'POST /api/usdc/transfer': {
                description: 'Transfer USDC from treasury to user wallet',
                auth: true,
                body: {
                    user_id: { type: 'number', required: true },
                    wallet_address: { type: 'string', required: true, format: 'solana-address' },
                    amount_usdc: { type: 'number', required: true, min: 0.000001 },
                    order_id: { type: 'string', required: false },
                    reference: { type: 'string', required: false }
                },
                response: {
                    success: 'boolean',
                    signature: 'string',
                    amount: 'number',
                    recipient: 'string',
                    explorer_url: 'string'
                }
            },
            'GET /api/usdc/balance/:wallet': {
                description: 'Get USDC balance for wallet',
                auth: false,
                params: { wallet: 'Solana wallet address' },
                response: {
                    success: 'boolean',
                    wallet: 'string',
                    balance: 'number',
                    currency: 'USDC'
                }
            },
            'GET /api/usdc/verify/:signature': {
                description: 'Verify transaction signature',
                auth: false,
                params: { signature: 'Transaction signature' },
                response: {
                    success: 'boolean',
                    signature: 'string',
                    verified: 'boolean',
                    explorer_url: 'string'
                }
            }
        },
        tola: {
            'POST /api/tola/transfer': {
                description: 'Transfer TOLA incentives to user wallet',
                auth: true,
                body: {
                    user_id: { type: 'number', required: true },
                    wallet_address: { type: 'string', required: true, format: 'solana-address' },
                    amount_tola: { type: 'number', required: true },
                    reason: { type: 'string', enum: ['reward', 'bonus', 'airdrop', 'refund', 'incentive', 'other'] }
                },
                response: {
                    success: 'boolean',
                    signature: 'string',
                    amount: 'number',
                    recipient: 'string'
                }
            },
            'GET /api/tola/balance/:wallet': {
                description: 'Get TOLA balance for wallet',
                auth: false,
                params: { wallet: 'Solana wallet address' },
                response: {
                    success: 'boolean',
                    wallet: 'string',
                    balance: 'number',
                    currency: 'TOLA',
                    contract: 'string'
                }
            },
            'GET /tola/snapshot': {
                description: 'Get TOLA price and market data',
                auth: false,
                response: {
                    success: 'boolean',
                    data: {
                        price: 'number',
                        liquidity: 'number',
                        volume24h: 'number',
                        priceChange: 'object'
                    }
                }
            },
            'GET /tola/stats': {
                description: 'Get TOLA distribution statistics',
                auth: false,
                response: {
                    success: 'boolean',
                    distribution: 'object',
                    nfts: 'object'
                }
            }
        },
        nft: {
            'POST /api/nft/mint': {
                description: 'Mint a new NFT',
                auth: true,
                body: {
                    name: { type: 'string', required: true, maxLength: 32 },
                    symbol: { type: 'string', required: false, maxLength: 10, default: 'VORTEX' },
                    uri: { type: 'string', required: true, format: 'uri' },
                    description: { type: 'string', required: false },
                    seller_fee_basis_points: { type: 'number', min: 0, max: 10000, default: 500 },
                    creators: { type: 'array', description: 'Creator addresses and shares' },
                    recipient: { type: 'string', format: 'solana-address' },
                    is_mutable: { type: 'boolean', default: true }
                },
                response: {
                    success: 'boolean',
                    data: {
                        mint_address: 'string',
                        metadata_address: 'string',
                        token_account: 'string',
                        signature: 'string',
                        explorer_url: 'string'
                    }
                }
            },
            'POST /api/nft/transfer': {
                description: 'Transfer NFT to another wallet',
                auth: true,
                body: {
                    mint_address: { type: 'string', required: true, format: 'solana-address' },
                    recipient_wallet: { type: 'string', required: true, format: 'solana-address' }
                },
                response: {
                    success: 'boolean',
                    signature: 'string',
                    explorer_url: 'string'
                }
            },
            'GET /api/nft/:mint_address': {
                description: 'Get NFT details',
                auth: false,
                params: { mint_address: 'NFT mint address' },
                response: {
                    success: 'boolean',
                    data: {
                        mint_address: 'string',
                        name: 'string',
                        symbol: 'string',
                        uri: 'string',
                        owner: 'string',
                        attributes: 'array'
                    }
                }
            },
            'GET /api/nft/minted/recent': {
                description: 'Get recently minted NFTs',
                auth: false,
                query: { limit: { type: 'number', default: 20, max: 100 } },
                response: {
                    success: 'boolean',
                    data: { nfts: 'array', count: 'number' }
                }
            },
            'GET /api/nft/stats/overview': {
                description: 'Get NFT minting statistics',
                auth: false,
                response: {
                    success: 'boolean',
                    data: {
                        total_minted: 'number',
                        minted_last_hour: 'number',
                        service_healthy: 'boolean'
                    }
                }
            },
            'POST /api/nft/batch/mint': {
                description: 'Batch mint multiple NFTs (max 10)',
                auth: true,
                body: {
                    nfts: { type: 'array', maxItems: 10, items: 'NFTMintRequest' }
                },
                response: {
                    success: 'boolean',
                    data: {
                        total: 'number',
                        successful: 'number',
                        failed: 'number',
                        results: 'array'
                    }
                }
            }
        },
        payments: {
            'POST /api/payments/create-intent': {
                description: 'Create payment intent with deep link',
                auth: true,
                body: {
                    order_id: { type: 'string', required: true },
                    amount_usd: { type: 'number', required: true },
                    currency: { type: 'string', enum: ['USDC', 'TOLA'], default: 'USDC' },
                    buyer_email: { type: 'string', format: 'email' },
                    buyer_wallet: { type: 'string', format: 'solana-address' }
                },
                response: {
                    success: 'boolean',
                    data: {
                        id: 'string',
                        deep_link: 'string',
                        qr_data: 'string',
                        expires_at: 'string'
                    }
                }
            },
            'POST /api/payments/verify': {
                description: 'Verify payment transaction',
                auth: true,
                body: {
                    signature: { type: 'string', required: true },
                    order_id: { type: 'string', required: true }
                }
            },
            'GET /api/payments/status/:order_id': {
                description: 'Get payment status',
                auth: false,
                params: { order_id: 'Order ID' }
            }
        },
        assets: {
            'GET /api/assets/daily': {
                description: 'Get daily assets summary',
                auth: false,
                response: {
                    success: 'boolean',
                    data: {
                        total_assets: 'number',
                        new_today: 'number',
                        total_value_usdc: 'number',
                        featured: 'array'
                    }
                }
            },
            'POST /api/assets/daily/create': {
                description: 'Create daily asset bundle (admin)',
                auth: true
            },
            'GET /api/assets/products': {
                description: 'List all products with NFT status',
                auth: false
            }
        },
        swap: {
            'GET /api/swap/quote': {
                description: 'Get swap quote from Jupiter',
                auth: false,
                query: {
                    inputMint: 'Input token mint address',
                    outputMint: 'Output token mint address',
                    amount: 'Amount in smallest units',
                    slippageBps: 'Slippage in basis points (default: 100)'
                }
            },
            'GET /api/swap/tokens': {
                description: 'Get supported swap tokens',
                auth: false
            }
        },
        webhooks: {
            'POST /wc/webhooks/*': {
                description: 'WooCommerce webhook endpoints',
                auth: false,
                note: 'All webhooks return { success: true, message: string }',
                available: [
                    'product-published', 'order-created', 'order-paid',
                    'wallet-connected', 'tola-transaction', 'subscription-activated',
                    'usage-payment', 'stripe-purchase-completed', 'balance-spent',
                    'balance-sync', 'nft-minted', 'generation-completed',
                    'style-transfer', 'artwork-saved', 'collector-subscription',
                    'product-listed', 'huraii-vision', 'style-guided-generation'
                ]
            }
        },
        debug: {
            'GET /debug/routes': {
                description: 'List all registered routes',
                auth: false
            }
        }
    },
    errors: {
        400: 'Bad Request - Invalid input parameters',
        401: 'Unauthorized - Missing or invalid API key',
        403: 'Forbidden - Insufficient permissions',
        404: 'Not Found - Resource not found',
        429: 'Too Many Requests - Rate limit exceeded',
        500: 'Internal Server Error',
        503: 'Service Unavailable - Service not configured'
    },
    codes: {
        VALIDATION_ERROR: 'Input validation failed',
        SERVICE_UNAVAILABLE: 'Required service not available',
        MINT_FAILED: 'NFT minting failed',
        TRANSFER_FAILED: 'Token transfer failed',
        INVALID_MINT_ADDRESS: 'Invalid mint address format',
        INVALID_RECIPIENT: 'Invalid recipient wallet address',
        INSUFFICIENT_BALANCE: 'Insufficient balance for operation',
        NOT_FOUND: 'Requested resource not found'
    }
};

/**
 * GET /api/docs
 * Full API documentation
 */
router.get('/', (req: Request, res: Response) => {
    res.json({
        success: true,
        data: API_DOCS,
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/docs/endpoints
 * List of all endpoints
 */
router.get('/endpoints', (req: Request, res: Response) => {
    const endpoints: string[] = [];
    
    for (const [category, routes] of Object.entries(API_DOCS.endpoints)) {
        for (const route of Object.keys(routes)) {
            endpoints.push(`[${category}] ${route}`);
        }
    }
    
    res.json({
        success: true,
        count: endpoints.length,
        endpoints,
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/docs/openapi
 * OpenAPI 3.0 spec (simplified)
 */
router.get('/openapi', (req: Request, res: Response) => {
    const openapi = {
        openapi: '3.0.0',
        info: API_DOCS.info,
        servers: API_DOCS.servers,
        paths: {},
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key'
                }
            }
        }
    };
    
    res.json(openapi);
});

export default router;
export { router as docsRoutes };
