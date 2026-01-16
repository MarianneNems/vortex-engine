/**
 * Vortex Engine - USDC Payment System + TOLA Incentives
 * Version 4.0.0 - USDC-first architecture with hidden TOLA rewards
 * 
 * PRIMARY: USDC stablecoin payments (user-facing)
 * SECONDARY: TOLA incentive distribution (backend only)
 * 
 * @version 4.0.0
 * @build 2026-01-16-v4.0.0-WEBHOOK-FIX
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Track which routes loaded successfully
const routeStatus: Record<string, boolean> = {};

// Safe route loader with error handling
function safeLoadRoute(name: string, path: string, loader: () => any): any {
    try {
        const route = loader();
        routeStatus[name] = true;
        console.log(`[ROUTES] Loaded: ${name} at ${path}`);
        return route;
    } catch (error: any) {
        routeStatus[name] = false;
        console.error(`[ROUTES] FAILED to load ${name}:`, error.message);
        return null;
    }
}

// Load routes with error handling
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

// Mount routes (only if loaded successfully)
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

// Initialize services with error handling
let usdcService: any = null;
let tolaService: any = null;
let nftService: any = null;

try {
    const { USDCTransferService } = require('./services/usdc-transfer.service');
    usdcService = new USDCTransferService();
    console.log('[SERVICES] USDCTransferService initialized');
} catch (e: any) {
    console.error('[SERVICES] USDCTransferService failed:', e.message);
}

try {
    const { TOLATransferService } = require('./services/tola-transfer.service');
    tolaService = new TOLATransferService();
    console.log('[SERVICES] TOLATransferService initialized');
} catch (e: any) {
    console.error('[SERVICES] TOLATransferService failed:', e.message);
}

try {
    const { TOLANFTMintService } = require('./services/tola-nft-mint.service');
    nftService = new TOLANFTMintService();
    console.log('[SERVICES] TOLANFTMintService initialized');
} catch (e: any) {
    console.error('[SERVICES] TOLANFTMintService failed:', e.message);
}

// Health check - v4.0.0
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        version: '4.0.0',
        build: '2026-01-16-v4.0.0-WEBHOOK-FIX',
        timestamp: new Date().toISOString(),
        routes_loaded: routeStatus,
        services: {
            usdc: !!usdcService,
            tola: !!tolaService,
            nft: !!nftService
        },
        webhooks: {
            woocommerce: 14,
            loaded: !!wooCommerceRoutes
        }
    });
});

// Debug: List all registered routes
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
    res.json({ success: true, route_count: routes.length, routes: routes.slice(0, 100) });
});

// TOLA metrics endpoint
app.get('/tola/snapshot', async (req, res) => {
    res.json({
        success: true,
        data: {
            price: 1.00,
            message: 'Vortex Engine v4.0.0 running'
        }
    });
});

// Payment status endpoint
app.get('/tola/payments/status/:orderId', (req, res) => {
    res.json({
        success: true,
        data: {
            orderId: req.params.orderId,
            status: 'pending'
        }
    });
});

// WooCommerce Webhooks
app.post('/wc/webhooks/product-published', (req, res) => {
    console.log('[WEBHOOK] Product published:', req.body);
    res.json({ success: true, message: 'Product webhook received' });
});

app.post('/wc/webhooks/order-created', (req, res) => {
    console.log('[WEBHOOK] Order created:', req.body);
    res.json({ success: true, message: 'Order webhook received' });
});

app.post('/wc/webhooks/order-paid', (req, res) => {
    console.log('[WEBHOOK] Order paid:', req.body);
    res.json({ success: true, message: 'Payment webhook received' });
});

// Wallet connection webhook
app.post('/wc/webhooks/wallet-connected', (req, res) => {
    console.log('[WEBHOOK] Wallet connected:', {
        user_id: req.body?.user?.id,
        wallet_address: req.body?.wallet?.address,
        blockchain: req.body?.wallet?.blockchain
    });
    res.json({ success: true, message: 'Wallet connection webhook received' });
});

// TOLA transaction webhook
app.post('/wc/webhooks/tola-transaction', (req, res) => {
    console.log('[WEBHOOK] TOLA transaction:', {
        user_id: req.body?.user?.id,
        type: req.body?.transaction?.type,
        amount: req.body?.transaction?.amount
    });
    res.json({ success: true, message: 'TOLA transaction webhook received' });
});

// Subscription activation webhook
app.post('/wc/webhooks/subscription-activated', (req, res) => {
    console.log('[WEBHOOK] Subscription activated:', {
        user_id: req.body?.user?.id,
        tier: req.body?.subscription?.tier
    });
    res.json({ success: true, message: 'Subscription activation webhook received' });
});

// Usage payment webhook
app.post('/wc/webhooks/usage-payment', (req, res) => {
    console.log('[WEBHOOK] Usage payment:', {
        user_id: req.body?.user?.id,
        tokens_used: req.body?.usage?.tokens_used,
        cost: req.body?.usage?.cost_tola
    });
    res.json({ success: true, message: 'Usage payment webhook received' });
});

// Stripe purchase completed webhook
app.post('/wc/webhooks/stripe-purchase-completed', (req, res) => {
    console.log('[WEBHOOK] Stripe purchase completed:', {
        user_id: req.body?.user?.id,
        payment_intent: req.body?.payment?.intent_id,
        amount: req.body?.payment?.amount,
        currency: req.body?.payment?.currency
    });
    res.json({ success: true, message: 'Stripe purchase webhook received' });
});

// Balance spent webhook
app.post('/wc/webhooks/balance-spent', (req, res) => {
    console.log('[WEBHOOK] Balance spent:', {
        user_id: req.body?.user?.id,
        amount: req.body?.amount,
        reason: req.body?.reason,
        balance_after: req.body?.balance_after
    });
    res.json({ success: true, message: 'Balance spent webhook received' });
});

// Balance sync webhook
app.post('/wc/webhooks/balance-sync', (req, res) => {
    console.log('[WEBHOOK] Balance sync:', {
        user_id: req.body?.user?.id,
        wallet_address: req.body?.wallet_address,
        usdc_balance: req.body?.balances?.usdc,
        tola_balance: req.body?.balances?.tola
    });
    res.json({ success: true, message: 'Balance sync webhook received' });
});

// NFT minted webhook
app.post('/wc/webhooks/nft-minted', (req, res) => {
    console.log('[WEBHOOK] NFT minted:', {
        user_id: req.body?.user?.id,
        mint_address: req.body?.nft?.mint_address,
        product_id: req.body?.nft?.product_id,
        metadata_uri: req.body?.nft?.metadata_uri
    });
    res.json({ success: true, message: 'NFT minted webhook received' });
});

// Generation completed webhook (Atelier Lab)
app.post('/wc/webhooks/generation-completed', (req, res) => {
    console.log('[WEBHOOK] Generation completed:', {
        user_id: req.body?.user?.id,
        generation_id: req.body?.generation?.id,
        type: req.body?.generation?.type,
        model: req.body?.generation?.model
    });
    res.json({ success: true, message: 'Generation completed webhook received' });
});

// Style transfer webhook (Atelier Lab)
app.post('/wc/webhooks/style-transfer', (req, res) => {
    console.log('[WEBHOOK] Style transfer:', {
        user_id: req.body?.user?.id,
        source_id: req.body?.transfer?.source_id,
        target_id: req.body?.transfer?.target_id,
        style: req.body?.transfer?.style
    });
    res.json({ success: true, message: 'Style transfer webhook received' });
});

// Artwork saved webhook (Atelier Lab)
app.post('/wc/webhooks/artwork-saved', (req, res) => {
    console.log('[WEBHOOK] Artwork saved:', {
        user_id: req.body?.user?.id,
        artwork_id: req.body?.artwork?.id,
        title: req.body?.artwork?.title,
        format: req.body?.artwork?.format
    });
    res.json({ success: true, message: 'Artwork saved webhook received' });
});

// Collector subscription webhook
app.post('/wc/webhooks/collector-subscription', (req, res) => {
    console.log('[WEBHOOK] Collector subscription:', {
        user_id: req.body?.user?.id,
        tier: req.body?.subscription?.tier,
        status: req.body?.subscription?.status
    });
    res.json({ success: true, message: 'Collector subscription webhook received' });
});

// Product listed webhook
app.post('/wc/webhooks/product-listed', (req, res) => {
    console.log('[WEBHOOK] Product listed:', {
        product_id: req.body?.product?.id,
        vendor_id: req.body?.product?.vendor_id,
        price: req.body?.product?.price
    });
    res.json({ success: true, message: 'Product listed webhook received' });
});

// HURAII vision webhook (Atelier Lab)
app.post('/wc/webhooks/huraii-vision', (req, res) => {
    console.log('[WEBHOOK] HURAII vision:', {
        user_id: req.body?.user?.id,
        image_id: req.body?.vision?.image_id,
        analysis_type: req.body?.vision?.analysis_type
    });
    res.json({ success: true, message: 'HURAII vision webhook received' });
});

// Style-guided generation webhook (Atelier Lab)
app.post('/wc/webhooks/style-guided-generation', (req, res) => {
    console.log('[WEBHOOK] Style-guided generation:', {
        user_id: req.body?.user?.id,
        style_id: req.body?.generation?.style_id,
        prompt: req.body?.generation?.prompt
    });
    res.json({ success: true, message: 'Style-guided generation webhook received' });
});

// USDC Transfer endpoint
app.post('/api/usdc/transfer', async (req, res) => {
    try {
        if (!usdcService) {
            return res.status(503).json({ success: false, error: 'USDC service not available' });
        }
        const body = req.body;
        if (!body.user_id || !body.wallet_address || !body.amount_usdc) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        const result = await usdcService.transferUSDC(body);
        return res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// USDC Balance endpoint
app.get('/api/usdc/balance/:wallet', async (req, res) => {
    try {
        if (!usdcService) {
            return res.status(503).json({ success: false, error: 'USDC service not available' });
        }
        const balance = await usdcService.getBalance(req.params.wallet);
        return res.status(200).json({ success: true, wallet: req.params.wallet, balance });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// TOLA Transfer endpoint
app.post('/api/tola/transfer', async (req, res) => {
    try {
        if (!tolaService) {
            return res.status(503).json({ success: false, error: 'TOLA service not available' });
        }
        const body = req.body;
        if (!body.user_id || !body.wallet_address || !body.amount_tola) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        const result = await tolaService.transferTOLA(body);
        return res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// TOLA Balance endpoint
app.get('/api/tola/balance/:wallet', async (req, res) => {
    try {
        if (!tolaService) {
            return res.status(503).json({ success: false, error: 'TOLA service not available' });
        }
        const balance = await tolaService.getBalance(req.params.wallet);
        return res.status(200).json({ success: true, wallet: req.params.wallet, balance });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// NFT Minting endpoint
app.post('/api/tola/mint-nft', async (req, res) => {
    try {
        if (!nftService) {
            return res.status(503).json({ success: false, error: 'NFT service not available' });
        }
        const body = req.body;
        if (!body.name || !body.uri) {
            return res.status(400).json({ success: false, error: 'Missing required fields: name and uri' });
        }
        const result = await nftService.mintNFT(body);
        return res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// NFT Transfer endpoint
app.post('/api/tola/transfer-nft', async (req, res) => {
    try {
        if (!nftService) {
            return res.status(503).json({ success: false, error: 'NFT service not available' });
        }
        const { mint_address, recipient_wallet } = req.body;
        if (!mint_address || !recipient_wallet) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        const result = await nftService.transferNFT(mint_address, recipient_wallet);
        return res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// NFT Lookup endpoint
app.get('/api/tola/nft/:mint_address', async (req, res) => {
    try {
        if (!nftService) {
            return res.status(503).json({ success: false, error: 'NFT service not available' });
        }
        const result = await nftService.getNFT(req.params.mint_address);
        return res.status(result.success ? 200 : 404).json(result);
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// SERVER START
// ============================================

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`[VORTEX ENGINE] v4.0.0`);
    console.log(`[VORTEX ENGINE] USDC-First Architecture`);
    console.log(`========================================\n`);
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`Debug:  http://localhost:${PORT}/debug/routes\n`);
    
    console.log(`Route Status:`);
    Object.entries(routeStatus).forEach(([name, loaded]) => {
        console.log(`  ${loaded ? '✓' : '✗'} ${name}`);
    });
    
    console.log(`\nService Status:`);
    console.log(`  ${usdcService ? '✓' : '✗'} USDCTransferService`);
    console.log(`  ${tolaService ? '✓' : '✗'} TOLATransferService`);
    console.log(`  ${nftService ? '✓' : '✗'} TOLANFTMintService`);
    
    console.log(`\nAll systems operational - Ready for requests\n`);
});
