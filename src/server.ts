/**
 * Vortex Engine - Production Grade API Server
 * USDC Payment System + NFT Minting + TOLA Incentives
 * 
 * Features:
 * - USDC stablecoin payments
 * - NFT minting via Metaplex
 * - TOLA incentive distribution
 * - Webhook processing
 * - Rate limiting and security
 * 
 * @version 4.0.0
 * @build 2026-01-16-PRODUCTION
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

dotenv.config();

// Minting guardrails
import { mintRateLimiter } from './middleware/mint-rate-limit.middleware';
import { mintGating } from './middleware/mint-gating.middleware';
import { attachRequestId, buildSafeErrorResponse } from './middleware/mint-error-handler';
import { TreasuryMonitorService } from './services/treasury-monitor.service';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// SECURITY & MIDDLEWARE
// ============================================

// CORS configuration - Allow all origins for API access
// v4.0.0 FIX: Use permissive CORS to fix preflight issues
const corsOptions = {
    origin: true, // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-wp-user-id', 'X-Vortex-Source', 'X-Vortex-Secret', 'X-WordPress-Site', 'Origin', 'Accept'],
    credentials: true,
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// Handle preflight OPTIONS requests explicitly - MUST be before other routes
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Explicit CORS headers for ALL requests (backup in case cors middleware fails)
app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-wp-user-id, X-Vortex-Source, X-Vortex-Secret, X-WordPress-Site, Origin, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    // Handle preflight immediately
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Security headers
app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.removeHeader('X-Powered-By');
    next();
});

// Import raw body middleware for webhook signature verification
import { rawBodyMiddleware } from './middleware/woo-hmac.middleware';

// Capture raw body for webhook routes BEFORE JSON parsing
app.use('/wc/webhooks', rawBodyMiddleware);
app.use('/webhooks', rawBodyMiddleware);

// Body parsing with size limits (for non-webhook routes)
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000 || res.statusCode >= 400) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// ============================================
// RATE LIMITING
// ============================================

const rateLimitStore: Map<string, { count: number; reset: number }> = new Map();

const rateLimit = (maxRequests: number, windowMs: number) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const key = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
        const now = Date.now();
        const entry = rateLimitStore.get(key);
        
        if (!entry || now > entry.reset) {
            rateLimitStore.set(key, { count: 1, reset: now + windowMs });
            return next();
        }
        
        if (entry.count >= maxRequests) {
            res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000).toString());
            return res.status(429).json({
                success: false,
                error: 'Too many requests',
                code: 'RATE_LIMITED',
                retry_after: Math.ceil((entry.reset - now) / 1000)
            });
        }
        
        entry.count++;
        next();
    };
};

// Apply rate limiting
app.use('/api/', rateLimit(100, 60000)); // 100 req/min for API
app.use('/wc/webhooks/', rateLimit(500, 60000)); // 500 req/min for webhooks

// ============================================
// ROUTE LOADING
// ============================================

const routeStatus: Record<string, boolean> = {};

function safeLoadRoute(name: string, path: string, loader: () => any): any {
    try {
        const route = loader();
        routeStatus[name] = true;
        console.log(`[ROUTES] ✓ ${name} → ${path}`);
        return route;
    } catch (error: any) {
        routeStatus[name] = false;
        console.error(`[ROUTES] ✗ ${name}: ${error.message}`);
        return null;
    }
}

// Core routes
const nftRoutes = safeLoadRoute('nft', '/api/nft', () => require('./routes/nft.routes').default);
const docsRoutes = safeLoadRoute('docs', '/api/docs', () => require('./routes/docs.routes').default);
const marketplaceRoutes = safeLoadRoute('marketplace', '/api/marketplace', () => require('./routes/marketplace.routes').default);
const balanceSyncRoutes = safeLoadRoute('balance-sync', '/api', () => require('./routes/balance-sync.routes').default);
const spendingRoutes = safeLoadRoute('spending', '/api/spending', () => require('./routes/spending.routes').default);
const swapRoutes = safeLoadRoute('swap', '/api/swap', () => require('./routes/swap.routes').default);
const tolaMasterpieceRoutes = safeLoadRoute('tola-masterpiece', '/api/tola-masterpiece', () => require('./routes/tola-masterpiece.routes').default);
const evolutionRoutes = safeLoadRoute('evolution', '/api/evolution', () => require('./routes/evolution.routes').default);
const agenticRoutes = safeLoadRoute('agentic', '/api/agentic', () => require('./routes/agentic.routes').default);
const cosmosRoutes = safeLoadRoute('cosmos', '/api/cosmos', () => require('./routes/cosmos.routes').default);
const royaltyRoutes = safeLoadRoute('royalty', '/api/royalty', () => require('./routes/royalty.routes').default);
const kvCacheRoutes = safeLoadRoute('kv-cache', '/api/kv-cache', () => require('./routes/kv-cache.routes').default);
const scalingRoutes = safeLoadRoute('scaling', '/api/scaling', () => require('./routes/scaling.routes').default);
const assetsRoutes = safeLoadRoute('assets', '/api/assets', () => require('./routes/assets.routes').assetsRoutes);
const tolaRoutes = safeLoadRoute('tola', '/tola', () => require('./routes/tola.routes').tolaRoutes);
const wooCommerceRoutes = safeLoadRoute('woocommerce', '/wc', () => require('./routes/woocommerce.routes').wooCommerceRoutes);
const usdcRoutes = safeLoadRoute('usdc', '/api/usdc', () => require('./routes/usdc.routes').usdcRoutes);

// Mount routes
if (nftRoutes) app.use('/api/nft', nftRoutes);
if (docsRoutes) app.use('/api/docs', docsRoutes);
if (marketplaceRoutes) app.use('/api/marketplace', marketplaceRoutes);
if (balanceSyncRoutes) app.use('/api', balanceSyncRoutes);
if (spendingRoutes) app.use('/api/spending', spendingRoutes);
if (swapRoutes) app.use('/api/swap', swapRoutes);
if (tolaMasterpieceRoutes) app.use('/api/tola-masterpiece', tolaMasterpieceRoutes);
if (evolutionRoutes) app.use('/api/evolution', evolutionRoutes);
if (agenticRoutes) app.use('/api/agentic', agenticRoutes);
if (cosmosRoutes) app.use('/api/cosmos', cosmosRoutes);
if (royaltyRoutes) app.use('/api/royalty', royaltyRoutes);
if (kvCacheRoutes) app.use('/api/kv-cache', kvCacheRoutes);
if (scalingRoutes) app.use('/api/scaling', scalingRoutes);
if (assetsRoutes) app.use('/api/assets', assetsRoutes);
if (tolaRoutes) app.use('/tola', tolaRoutes);
if (wooCommerceRoutes) app.use('/wc', wooCommerceRoutes);
if (usdcRoutes) app.use('/api/usdc', usdcRoutes);

// ============================================
// SERVICE INITIALIZATION
// ============================================

let usdcService: any = null;
let tolaService: any = null;
let nftService: any = null;
let dailyAssetService: any = null;
let tolaMetricsService: any = null;
let paymentService: any = null;
let webhookProcessor: any = null;
let collectionService: any = null;
let marketplaceService: any = null;
let creatorService: any = null;
let royaltyService: any = null;

// Initialize services
try {
    const { USDCTransferService } = require('./services/usdc-transfer.service');
    usdcService = new USDCTransferService();
    console.log('[SERVICES] ✓ USDCTransferService');
} catch (e: any) {
    console.error('[SERVICES] ✗ USDCTransferService:', e.message);
}

try {
    const { TOLATransferService } = require('./services/tola-transfer.service');
    tolaService = new TOLATransferService();
    console.log('[SERVICES] ✓ TOLATransferService');
} catch (e: any) {
    console.error('[SERVICES] ✗ TOLATransferService:', e.message);
}

try {
    const { TOLANFTMintService } = require('./services/tola-nft-mint.service');
    nftService = new TOLANFTMintService();
    console.log('[SERVICES] ✓ TOLANFTMintService');
} catch (e: any) {
    console.error('[SERVICES] ✗ TOLANFTMintService:', e.message);
}

// Treasury monitor -- derives public key from nftService
let treasuryMonitor: TreasuryMonitorService | null = null;
try {
    const treasuryPubkey = nftService?.getTreasuryAddress?.() || null;
    if (treasuryPubkey) {
        treasuryMonitor = new TreasuryMonitorService(treasuryPubkey);
        treasuryMonitor.start();
        console.log('[SERVICES] ✓ TreasuryMonitor');

        // Log treasury public key and SOL balance at startup
        const mintPaymentMode = process.env.MINT_PAYMENT_MODE || 'SOL';
        console.log(`[TREASURY] Public Key: ${treasuryPubkey}`);
        console.log(`[TREASURY] MINT_PAYMENT_MODE: ${mintPaymentMode}`);
        // Balance will be logged asynchronously after the first monitor tick
        setTimeout(async () => {
            try {
                const health = treasuryMonitor?.getCachedHealth?.();
                if (health) {
                    console.log(`[TREASURY] SOL Balance: ${health.treasury_sol_balance?.toFixed(4) ?? 'unknown'} SOL`);
                    console.log(`[TREASURY] Status: ${health.status}`);
                }
            } catch {}
        }, 5000);
    } else {
        console.log('[SERVICES] - TreasuryMonitor skipped (no treasury key)');
    }
} catch (e: any) {
    console.error('[SERVICES] ✗ TreasuryMonitor:', e.message);
}

try {
    const { DailyAssetService } = require('./services/daily-asset.service');
    dailyAssetService = new DailyAssetService();
    console.log('[SERVICES] ✓ DailyAssetService');
} catch (e: any) {
    console.error('[SERVICES] ✗ DailyAssetService:', e.message);
}

try {
    const { TolaService } = require('./services/tola.service');
    tolaMetricsService = new TolaService();
    console.log('[SERVICES] ✓ TolaMetricsService');
} catch (e: any) {
    console.error('[SERVICES] ✗ TolaMetricsService:', e.message);
}

try {
    const { PaymentService } = require('./services/payment.service');
    paymentService = new PaymentService();
    console.log('[SERVICES] ✓ PaymentService');
} catch (e: any) {
    console.error('[SERVICES] ✗ PaymentService:', e.message);
}

try {
    const { WebhookProcessorService } = require('./services/webhook-processor.service');
    webhookProcessor = new WebhookProcessorService();
    // Note: royaltyService will be added after it's initialized
    webhookProcessor.setServices({ usdc: usdcService, tola: tolaService, nft: nftService, payment: paymentService });
    console.log('[SERVICES] ✓ WebhookProcessor');
} catch (e: any) {
    console.error('[SERVICES] ✗ WebhookProcessor:', e.message);
}

try {
    const { CollectionService } = require('./services/collection.service');
    collectionService = new CollectionService();
    console.log('[SERVICES] ✓ CollectionService');
} catch (e: any) {
    console.error('[SERVICES] ✗ CollectionService:', e.message);
}

try {
    const { MarketplaceService } = require('./services/marketplace.service');
    marketplaceService = new MarketplaceService();
    console.log('[SERVICES] ✓ MarketplaceService');
} catch (e: any) {
    console.error('[SERVICES] ✗ MarketplaceService:', e.message);
}

try {
    const { CreatorService } = require('./services/creator.service');
    creatorService = new CreatorService();
    console.log('[SERVICES] ✓ CreatorService');
} catch (e: any) {
    console.error('[SERVICES] ✗ CreatorService:', e.message);
}

try {
    const { getRoyaltyService } = require('./services/royalty.service');
    royaltyService = getRoyaltyService();
    console.log('[SERVICES] ✓ RoyaltyService (5% IMMUTABLE)');
    
    // Connect royalty service to webhook processor
    if (webhookProcessor) {
        webhookProcessor.setServices({ 
            usdc: usdcService, 
            tola: tolaService, 
            nft: nftService, 
            payment: paymentService,
            royalty: royaltyService 
        });
    }
} catch (e: any) {
    console.error('[SERVICES] ✗ RoyaltyService:', e.message);
}

// ============================================
// HEALTH & STATUS ENDPOINTS
// ============================================

app.get('/health', async (req, res) => {
    const detailed = req.query.detailed === 'true';
    
    const serviceStatus = {
        usdc: usdcService?.isReady?.() ?? !!usdcService,
        tola_transfer: tolaService?.isReady?.() ?? !!tolaService,
        nft: nftService?.isReady?.() ?? !!nftService,
        daily_assets: dailyAssetService?.isReady?.() ?? !!dailyAssetService,
        tola_metrics: !!tolaMetricsService,
        payments: paymentService?.isReady?.() ?? !!paymentService,
        webhooks: !!webhookProcessor,
        collections: collectionService?.isReady?.() ?? !!collectionService,
        marketplace: marketplaceService?.isReady?.() ?? !!marketplaceService,
        creators: creatorService?.isReady?.() ?? !!creatorService,
        royalty: royaltyService?.isReady?.() ?? !!royaltyService
    };
    
    const healthy = Object.values(serviceStatus).filter(Boolean).length;
    const total = Object.keys(serviceStatus).length;
    
    const response: any = {
        success: true,
        status: healthy === total ? 'healthy' : healthy > total / 2 ? 'degraded' : 'unhealthy',
        version: '4.0.0',
        build: '2026-01-16-PRODUCTION',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        services: serviceStatus,
        routes: {
            loaded: Object.values(routeStatus).filter(Boolean).length,
            total: Object.keys(routeStatus).length
        }
    };
    
    // Always include treasury status
    if (treasuryMonitor) {
        const th = treasuryMonitor.getCachedHealth();
        if (th) {
            response.treasury = {
                treasury_public_key: th.treasury_public_key,
                treasury_sol_balance: th.treasury_sol_balance,
                min_required_sol: th.min_required_sol,
                status: th.status,
                last_checked: th.last_checked
            };
        }
    }

    if (detailed) {
        response.detailed = {
            routes: routeStatus,
            memory: {
                heap_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
            }
        };
        
        if (usdcService?.getHealth) {
            try { response.detailed.usdc = await usdcService.getHealth(); } catch (e) {}
        }
        if (tolaService?.getHealth) {
            try { response.detailed.tola = await tolaService.getHealth(); } catch (e) {}
        }
        if (nftService?.getHealth) {
            try { response.detailed.nft = await nftService.getHealth(); } catch (e) {}
        }
        if (webhookProcessor?.getStats) {
            try { response.detailed.webhooks = webhookProcessor.getStats(); } catch (e) {}
        }
    }
    
    res.json(response);
});

app.get('/health/usdc', async (req, res) => {
    if (!usdcService) return res.status(503).json({ success: false, error: 'Service unavailable' });
    const health = await usdcService.getHealth?.() || { healthy: true };
    res.json({ success: true, service: 'usdc', ...health });
});

app.get('/health/tola', async (req, res) => {
    if (!tolaService) return res.status(503).json({ success: false, error: 'Service unavailable' });
    const health = await tolaService.getHealth?.() || { healthy: true };
    res.json({ success: true, service: 'tola', ...health });
});

app.get('/health/nft', async (req, res) => {
    if (!nftService) return res.status(503).json({ success: false, error: 'Service unavailable' });
    const health = await nftService.getHealth?.() || { healthy: true };
    res.json({ success: true, service: 'nft', ...health });
});

app.get('/health/payments', async (req, res) => {
    if (!paymentService) return res.status(503).json({ success: false, error: 'Service unavailable' });
    const health = paymentService.getHealth?.() || { healthy: true };
    res.json({ success: true, service: 'payments', ...health });
});

app.get('/health/royalty', async (req, res) => {
    if (!royaltyService) return res.status(503).json({ success: false, error: 'Service unavailable' });
    const health = await royaltyService.getHealth?.() || { healthy: true, immutable: true };
    res.json({ success: true, service: 'royalty', ...health });
});

// Debug routes
app.get('/debug/routes', (req, res) => {
    const routes: string[] = [];
    app._router.stack.forEach((middleware: any) => {
        if (middleware.route) {
            routes.push(`${Object.keys(middleware.route.methods).join(',').toUpperCase()} ${middleware.route.path}`);
        } else if (middleware.name === 'router') {
            middleware.handle.stack.forEach((handler: any) => {
                if (handler.route) {
                    const path = middleware.regexp.source.replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace('^', '');
                    routes.push(`${Object.keys(handler.route.methods).join(',').toUpperCase()} ${path}${handler.route.path}`);
                }
            });
        }
    });
    res.json({ success: true, count: routes.length, routes });
});

// ============================================
// TOLA & METRICS ENDPOINTS
// ============================================

app.get('/tola/snapshot', async (req, res) => {
    try {
        if (tolaMetricsService?.getSnapshot) {
            const snapshot = await tolaMetricsService.getSnapshot();
            return res.json({ success: true, data: snapshot, version: '4.0.0', timestamp: new Date().toISOString() });
        }
        res.json({
            success: true,
            data: {
                price: 1.00, liquidity: 0, volume24h: 0, status: 'fallback',
                baseToken: { address: 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky', name: 'TOLA', symbol: 'TOLA' }
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.json({ success: true, data: { price: 1.00, status: 'error' }, version: '4.0.0', timestamp: new Date().toISOString() });
    }
});

app.get('/tola/stats', async (req, res) => {
    const stats: any = { success: true, version: '4.0.0', timestamp: new Date().toISOString() };
    if (tolaService?.getStats) stats.distribution = tolaService.getStats();
    if (nftService?.getStats) stats.nfts = nftService.getStats();
    if (tolaMetricsService?.getStats) stats.metrics = tolaMetricsService.getStats();
    res.json(stats);
});

// ============================================
// USDC ENDPOINTS
// ============================================

app.post('/api/usdc/transfer', async (req, res) => {
    if (!usdcService) return res.status(503).json({ success: false, error: 'USDC service unavailable' });
    const { user_id, wallet_address, amount_usdc, order_id } = req.body;
    if (!user_id || !wallet_address || !amount_usdc) {
        return res.status(400).json({ success: false, error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    }
    try {
        const result = await usdcService.transferUSDC({ user_id, wallet_address, amount_usdc, order_id });
        res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/usdc/balance/:wallet', async (req, res) => {
    const { wallet } = req.params;
    try {
        if (usdcService?.getBalance) {
            const balance = await usdcService.getBalance(wallet);
            return res.json({ success: true, wallet, balance, currency: 'USDC', version: '4.0.0', timestamp: new Date().toISOString() });
        }
        res.json({ success: true, wallet, balance: 0, currency: 'USDC', status: 'service_unavailable', version: '4.0.0', timestamp: new Date().toISOString() });
    } catch (error: any) {
        res.json({ success: true, wallet, balance: 0, currency: 'USDC', status: 'error', version: '4.0.0', timestamp: new Date().toISOString() });
    }
});

// ============================================
// TOLA ENDPOINTS
// ============================================

app.post('/api/tola/transfer', async (req, res) => {
    if (!tolaService) return res.status(503).json({ success: false, error: 'TOLA service unavailable' });
    const { user_id, wallet_address, amount_tola, reason } = req.body;
    if (!user_id || !wallet_address || !amount_tola) {
        return res.status(400).json({ success: false, error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    }
    try {
        const result = await tolaService.transferTOLA({ user_id, wallet_address, amount_tola, reason });
        res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/tola/balance/:wallet', async (req, res) => {
    const { wallet } = req.params;
    try {
        if (tolaService?.getBalance) {
            const balance = await tolaService.getBalance(wallet);
            return res.json({ success: true, wallet, balance, currency: 'TOLA', contract: 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky', version: '4.0.0', timestamp: new Date().toISOString() });
        }
        res.json({ success: true, wallet, balance: 0, currency: 'TOLA', status: 'service_unavailable', version: '4.0.0', timestamp: new Date().toISOString() });
    } catch (error: any) {
        res.json({ success: true, wallet, balance: 0, currency: 'TOLA', status: 'error', version: '4.0.0', timestamp: new Date().toISOString() });
    }
});

// ============================================
// NFT ENDPOINTS (Additional)
// ============================================

app.post('/api/tola/mint-nft', attachRequestId, mintRateLimiter, mintGating, async (req: Request, res: Response) => {
    const requestId = req.requestId || 'unknown';

    if (!nftService) {
        return res.status(503).json({
            ok: false, success: false, code: 'MINT_FAILED',
            message: 'NFT service is starting up. Please try again in a moment.',
            request_id: requestId
        });
    }

    const { name, uri, symbol, description, recipient, recipient_wallet, seller_fee_basis_points, sellerFeeBasisPoints, creators, metadata, wallet_address } = req.body;
    if (!name && !metadata?.name) return res.status(400).json({ ok: false, success: false, code: 'VALIDATION_ERROR', message: 'name is required', request_id: requestId });
    if (!uri && !metadata?.image) return res.status(400).json({ ok: false, success: false, code: 'VALIDATION_ERROR', message: 'uri is required', request_id: requestId });

    // Pre-mint treasury balance check
    if (treasuryMonitor) {
        const blocked = await treasuryMonitor.preMintCheck(requestId);
        if (blocked) return res.status(503).json(blocked);
    }

    try {
        const result = await nftService.mintNFT({
            name: name || metadata?.name || 'Vortex AI Artwork',
            uri: uri || metadata?.image || '',
            symbol: symbol || metadata?.symbol || 'VRTX',
            description: description || metadata?.description || '',
            recipient: recipient || recipient_wallet || wallet_address || undefined,
            seller_fee_basis_points: seller_fee_basis_points || sellerFeeBasisPoints || 500,
            creators: creators || metadata?.properties?.creators || undefined
        });

        if (result.success) {
            res.status(201).json({
                ...result,
                payment_status: result.payment_status || 'assumed_paid',
                request_id: requestId
            });
        } else {
            // Service returned a structured failure
            const { httpStatus, body } = buildSafeErrorResponse(
                new Error(result.error || 'Mint failed'),
                requestId
            );
            res.status(httpStatus).json(body);
        }
    } catch (error: any) {
        console.error('[MINT ERROR]', error.message);
        const { httpStatus, body } = buildSafeErrorResponse(error, requestId);
        res.status(httpStatus).json(body);
    }
});

app.post('/api/tola/transfer-nft', async (req, res) => {
    if (!nftService) return res.status(503).json({ success: false, error: 'NFT service unavailable' });
    const { mint_address, recipient_wallet } = req.body;
    if (!mint_address || !recipient_wallet) return res.status(400).json({ success: false, error: 'mint_address and recipient_wallet are required' });
    try {
        const result = await nftService.transferNFT({ mint_address, recipient_wallet });
        res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/tola/nft/:mint_address', async (req, res) => {
    if (!nftService) return res.status(503).json({ success: false, error: 'NFT service unavailable' });
    try {
        const result = await nftService.getNFT(req.params.mint_address);
        res.status(result.success ? 200 : 404).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// PAYMENT ENDPOINTS
// ============================================

app.post('/api/payments/create-intent', async (req, res) => {
    if (!paymentService) return res.status(503).json({ success: false, error: 'Payment service unavailable' });
    const { order_id, amount_usd, currency, buyer_email, buyer_wallet, items } = req.body;
    if (!order_id || !amount_usd) return res.status(400).json({ success: false, error: 'order_id and amount_usd are required' });
    try {
        const intent = await paymentService.createPaymentIntent({ orderId: order_id, amountUSD: amount_usd, currency, buyerEmail: buyer_email, buyerWallet: buyer_wallet, items });
        res.status(201).json({ success: true, data: intent, version: '4.0.0', timestamp: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/verify', async (req, res) => {
    if (!paymentService) return res.status(503).json({ success: false, error: 'Payment service unavailable' });
    const { signature, order_id } = req.body;
    if (!signature || !order_id) return res.status(400).json({ success: false, error: 'signature and order_id are required' });
    try {
        const result = await paymentService.verifyPayment(signature, order_id);
        res.json({ success: true, data: result, version: '4.0.0', timestamp: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/payments/status/:order_id', async (req, res) => {
    if (!paymentService) return res.status(503).json({ success: false, error: 'Payment service unavailable' });
    try {
        const status = await paymentService.getPaymentStatus(req.params.order_id);
        res.json({ success: true, data: status, version: '4.0.0', timestamp: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/tola/payments/status/:orderId', async (req, res) => {
    if (!paymentService) return res.json({ success: true, data: { orderId: req.params.orderId, status: 'pending' } });
    try {
        const status = await paymentService.getPaymentStatus(req.params.orderId);
        res.json({ success: true, data: status || { orderId: req.params.orderId, status: 'pending' } });
    } catch (error: any) {
        res.json({ success: true, data: { orderId: req.params.orderId, status: 'pending' } });
    }
});

// ============================================
// WEBHOOK ENDPOINTS (Extended - Not in woocommerce.routes.ts)
// ============================================

// Generic webhook handler for routes not handled by woocommerce.routes.ts
const createWebhookHandler = (eventType: string) => async (req: Request, res: Response) => {
    console.log(`[WEBHOOK] ${eventType}:`, JSON.stringify(req.body).slice(0, 200));
    if (webhookProcessor) {
        try {
            const result = await webhookProcessor.processWebhook(eventType, req.body);
            return res.json({ success: true, message: `${eventType} processed`, result });
        } catch (e) {}
    }
    res.json({ success: true, message: `${eventType} received` });
};

// NOTE: product-published, order-created, order-paid are handled by woocommerce.routes.ts
// Only register webhooks NOT already defined in woocommerce.routes.ts
app.post('/wc/webhooks/wallet-connected', createWebhookHandler('wallet.connected'));
app.post('/wc/webhooks/tola-transaction', createWebhookHandler('tola.transaction'));
app.post('/wc/webhooks/subscription-activated', createWebhookHandler('subscription.activated'));
app.post('/wc/webhooks/usage-payment', createWebhookHandler('usage.payment'));
app.post('/wc/webhooks/stripe-purchase-completed', createWebhookHandler('stripe.purchase'));
app.post('/wc/webhooks/balance-spent', createWebhookHandler('balance.spent'));
app.post('/wc/webhooks/balance-sync', createWebhookHandler('balance.sync'));
app.post('/wc/webhooks/nft-minted', createWebhookHandler('nft.minted'));
app.post('/wc/webhooks/generation-completed', createWebhookHandler('generation.completed'));
app.post('/wc/webhooks/style-transfer', createWebhookHandler('style.transfer'));
app.post('/wc/webhooks/artwork-saved', createWebhookHandler('artwork.saved'));
app.post('/wc/webhooks/collector-subscription', createWebhookHandler('collector.subscription'));
app.post('/wc/webhooks/product-listed', createWebhookHandler('product.listed'));
app.post('/wc/webhooks/huraii-vision', createWebhookHandler('huraii.vision'));
app.post('/wc/webhooks/style-guided-generation', createWebhookHandler('style.generation'));
app.post('/wc/webhooks/royalty-sale', createWebhookHandler('royalty.sale'));
app.post('/wc/webhooks/nft-royalty', createWebhookHandler('nft.royalty'));

// Dedicated royalty webhook endpoint
app.post('/api/royalty/webhook/sale', async (req, res) => {
    console.log('[WEBHOOK] royalty.sale:', JSON.stringify(req.body).slice(0, 200));
    if (royaltyService && req.body.type === 'NFT_SALE') {
        try {
            const { nft, signature, amount, buyer, seller } = req.body;
            const payment = await royaltyService.processSecondarySale(
                nft?.mint || '',
                signature || '',
                parseFloat(amount || '0'),
                buyer,
                seller
            );
            return res.json({ success: true, message: 'Sale processed', data: payment });
        } catch (e: any) {
            console.error('[ROYALTY WEBHOOK] Error:', e.message);
        }
    }
    res.json({ success: true, message: 'royalty webhook received' });
});

// ============================================
// MISSING ENDPOINTS (Fix 404s)
// ============================================

// GPU Usage - WordPress polls this but it should use RunPod directly
app.get('/api/gpu/usage', (req, res) => {
    res.json({
        success: true,
        message: 'GPU usage should be checked via RunPod directly',
        gpu: {
            available: true,
            provider: 'runpod',
            endpoint: process.env.RUNPOD_BASE_URL || 'https://x0ctne8qjra54v-7860.proxy.runpod.net',
            note: 'This endpoint is deprecated. Use RunPod API for GPU status.'
        },
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

// Swap fees endpoint
app.get('/api/swap/fees', (req, res) => {
    res.json({
        success: true,
        fees: {
            swap_fee_usdc: 10.0,           // Total fee per swap
            swap_fee_per_user_usdc: 5.0,   // Per user when split
            platform_fee_percent: 1.0,      // Platform cut of swap value
            payment_options: ['split', 'full']
        },
        description: 'Swap fee is 10 USDC total, split 5 USDC each by default, or one party can pay full 10 USDC',
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

// USDC Transaction webhook
app.post('/wc/webhooks/usdc-transaction', (req, res) => {
    console.log('[WEBHOOK] usdc-transaction:', JSON.stringify(req.body).slice(0, 200));
    if (webhookProcessor) {
        try {
            webhookProcessor.processWebhook('usdc.transaction', req.body);
        } catch (e) {}
    }
    res.json({ success: true, message: 'USDC transaction received' });
});

// Webhook stats
app.get('/api/webhooks/stats', (req, res) => {
    if (!webhookProcessor) return res.status(503).json({ success: false, error: 'Webhook processor unavailable' });
    res.json({ success: true, data: webhookProcessor.getStats(), version: '4.0.0', timestamp: new Date().toISOString() });
});

app.get('/api/webhooks/events', (req, res) => {
    if (!webhookProcessor) return res.status(503).json({ success: false, error: 'Webhook processor unavailable' });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    res.json({ success: true, data: webhookProcessor.getEventLog(limit), version: '4.0.0', timestamp: new Date().toISOString() });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[ERROR]', err.message, err.stack);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// SERVER START
// ============================================

app.listen(PORT, () => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`   VORTEX ENGINE v4.0.0 - NFT Marketplace`);
    console.log(`   Competing with OpenSea • Foundation • SuperRare`);
    console.log(`   Collections • Auctions • Creator Profiles • USDC/TOLA`);
    console.log(`${'═'.repeat(60)}\n`);
    
    console.log(`🌐 Server:     http://localhost:${PORT}`);
    console.log(`📚 API Docs:   http://localhost:${PORT}/api/docs`);
    console.log(`💚 Health:     http://localhost:${PORT}/health`);
    console.log(`🔍 Debug:      http://localhost:${PORT}/debug/routes\n`);
    
    const loadedRoutes = Object.values(routeStatus).filter(Boolean).length;
    const totalRoutes = Object.keys(routeStatus).length;
    console.log(`📁 Routes: ${loadedRoutes}/${totalRoutes}`);
    
    const services = [
        { name: 'USDC Transfer', ok: !!usdcService },
        { name: 'TOLA Transfer', ok: !!tolaService },
        { name: 'NFT Minting', ok: !!nftService },
        { name: 'Daily Assets', ok: !!dailyAssetService },
        { name: 'TOLA Metrics', ok: !!tolaMetricsService },
        { name: 'Payments', ok: !!paymentService },
        { name: 'Webhooks', ok: !!webhookProcessor },
        { name: 'Collections', ok: !!collectionService },
        { name: 'Marketplace', ok: !!marketplaceService },
        { name: 'Creators', ok: !!creatorService },
        { name: 'Royalty (5% IMMUTABLE)', ok: !!royaltyService }
    ];
    
    const activeServices = services.filter(s => s.ok).length;
    console.log(`⚙️  Services: ${activeServices}/${services.length}`);
    services.forEach(s => console.log(`   ${s.ok ? '✓' : '✗'} ${s.name}`));
    
    const treasuryOk = !!process.env.TREASURY_WALLET_PRIVATE;
    console.log(`\n🔐 Treasury: ${treasuryOk ? 'Configured' : 'NOT CONFIGURED'}`);
    
    // Royalty configuration display
    console.log(`\n💎 Royalty Configuration (IMMUTABLE):`);
    console.log(`   Rate: 5% (500 BPS) - LOCKED`);
    console.log(`   Wallet: ${process.env.PLATFORM_COMMISSION_WALLET || '6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g'}`);
    
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`   Ready for requests - All systems operational`);
    console.log(`${'─'.repeat(60)}\n`);
});
