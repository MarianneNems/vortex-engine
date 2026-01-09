/**
 * Vortex Engine - USDC Payment System + TOLA Incentives
 * Version 4.1.0 - USDC-first architecture with hidden TOLA rewards
 * 
 * PRIMARY: USDC stablecoin payments (user-facing)
 * SECONDARY: TOLA incentive distribution (backend only)
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { USDCTransferService, USDCTransferRequest } from './services/usdc-transfer.service';
import { TOLATransferService, TOLATransferRequest } from './services/tola-transfer.service';
import { TOLANFTMintService, TOLANFTMintRequest } from './services/tola-nft-mint.service';
import balanceSyncRoutes from './routes/balance-sync.routes';
import spendingRoutes from './routes/spending.routes';
import swapRoutes from './routes/swap.routes';
import tolaMasterpieceRoutes from './routes/tola-masterpiece.routes';
import evolutionRoutes from './routes/evolution.routes';
import agenticRoutes from './routes/agentic.routes';
import cosmosRoutes from './routes/cosmos.routes';
import royaltyRoutes from './routes/royalty.routes';
import kvCacheRoutes from './routes/kv-cache.routes';
import scalingRoutes from './routes/scaling.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Balance sync routes (v4.0.0)
app.use('/api', balanceSyncRoutes);

// USDC Spending routes (v4.0.0)
app.use('/api/spending', spendingRoutes);

// NFT Swap routes (v4.0.0)
app.use('/api/swap', swapRoutes);

// TOLA Masterpiece routes (v4.0.0)
app.use('/api/tola-masterpiece', tolaMasterpieceRoutes);

// Evolution System routes (v4.1.0) - Test-time scaling, genetic evolution, open models
app.use('/api/evolution', evolutionRoutes);

// Agentic AI routes (v4.0.0) - Intelligent routing, NVIDIA integration, unified pipeline
app.use('/api/agentic', agenticRoutes);

// Cosmos AI routes (v4.0.0) - Physical robot embodiment, SECRET SAUCE
app.use('/api/cosmos', cosmosRoutes);

// Royalty Enforcement routes (v4.0.0) - Perpetual 5% royalty on data exports
app.use('/api/royalty', royaltyRoutes);

// KV Cache routes (v4.0.0) - Fast token generation with cached key-values
app.use('/api/kv-cache', kvCacheRoutes);

// AI Scaling routes (v4.0.0) - Scale up/out, heartbeat sync, distributed memory
app.use('/api/scaling', scalingRoutes);

// Initialize services
const usdcService = new USDCTransferService();
const tolaService = new TOLATransferService();
const nftService = new TOLANFTMintService();

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

// TOLA metrics endpoint
app.get('/tola/snapshot', async (req, res) => {
    res.json({
        success: true,
        data: {
            price: 1.00,
            message: 'Vortex Engine running'
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
        blockchain: req.body?.wallet?.blockchain,
        user_type: req.body?.user?.user_type,
        page: req.body?.page
    });
    
    // Store wallet connection event
    const event = {
        type: 'wallet_connected',
        timestamp: new Date().toISOString(),
        user_id: req.body?.user?.id,
        wallet_address: req.body?.wallet?.address,
        tola_balance: req.body?.tola_balance
    };
    
    res.json({ 
        success: true, 
        message: 'Wallet connection webhook received',
        event: event
    });
});

// TOLA transaction webhook
app.post('/wc/webhooks/tola-transaction', (req, res) => {
    console.log('[WEBHOOK] TOLA transaction:', {
        user_id: req.body?.user?.id,
        type: req.body?.transaction?.type,
        amount: req.body?.transaction?.amount,
        new_balance: req.body?.balance?.current,
        page: req.body?.page
    });
    
    const event = {
        type: 'tola_transaction',
        timestamp: new Date().toISOString(),
        user_id: req.body?.user?.id,
        transaction_type: req.body?.transaction?.type,
        amount: req.body?.transaction?.amount,
        balance: req.body?.balance?.current
    };
    
    res.json({ 
        success: true, 
        message: 'TOLA transaction webhook received',
        event: event
    });
});

// Subscription activation webhook
app.post('/wc/webhooks/subscription-activated', (req, res) => {
    console.log('[WEBHOOK] Subscription activated:', {
        user_id: req.body?.user?.id,
        tier: req.body?.subscription?.tier,
        wcfm_id: req.body?.subscription?.wcfm_membership_id,
        user_type: req.body?.user?.user_type,
        page: req.body?.page
    });
    
    const event = {
        type: 'subscription_activated',
        timestamp: new Date().toISOString(),
        user_id: req.body?.user?.id,
        subscription_tier: req.body?.subscription?.tier,
        wcfm_membership_id: req.body?.subscription?.wcfm_membership_id,
        tola_cost: req.body?.subscription?.tola_cost
    };
    
    res.json({ 
        success: true, 
        message: 'Subscription activation webhook received',
        event: event
    });
});

// Collector subscription webhook (special handling for WCFM ID 9005)
app.post('/wc/webhooks/collector-subscription', (req, res) => {
    console.log('[WEBHOOK] Collector subscription activated:', {
        user_id: req.body?.user_id,
        wcfm_id: req.body?.wcfm_membership_id,
        interface: req.body?.interface_file,
        access_level: req.body?.access_level
    });
    
    res.json({ 
        success: true, 
        message: 'Collector subscription webhook received',
        interface: 'index-collector.html'
    });
});

// Usage payment webhook (AI generation billing)
app.post('/wc/webhooks/usage-payment', (req, res) => {
    console.log('[WEBHOOK] Usage payment:', {
        user_id: req.body?.user?.id,
        tokens_used: req.body?.usage?.tokens_used,
        cost_tola: req.body?.usage?.cost_tola,
        hardware: req.body?.usage?.hardware,
        billing_type: req.body?.billing?.billing_type,
        multiplier: req.body?.billing?.multiplier,
        new_balance: req.body?.balance?.current
    });
    
    const event = {
        type: 'usage_payment',
        timestamp: new Date().toISOString(),
        user_id: req.body?.user?.id,
        tokens_used: req.body?.usage?.tokens_used,
        cost: req.body?.usage?.cost_tola,
        billing_multiplier: req.body?.billing?.multiplier,
        balance: req.body?.balance?.current
    };
    
    res.json({ 
        success: true, 
        message: 'Usage payment webhook received',
        event: event,
        billing_confirmed: true
    });
});

// USDC Transfer endpoint
app.post('/api/usdc/transfer', async (req, res) => {
    try {
        const body = req.body as USDCTransferRequest;
        
        if (!body.user_id || !body.wallet_address || !body.amount_usdc) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        console.log('[USDC TRANSFER] Request:', {
            user_id: body.user_id,
            wallet: body.wallet_address,
            amount: body.amount_usdc
        });
        
        const result = await usdcService.transferUSDC(body);
        
        if (result.success) {
            console.log('[USDC TRANSFER] Success:', result.tx_signature);
            return res.status(200).json(result);
        } else {
            console.error('[USDC TRANSFER] Failed:', result.error);
            return res.status(500).json(result);
        }
        
    } catch (error: any) {
        console.error('[USDC TRANSFER] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// USDC Balance endpoint
app.get('/api/usdc/balance/:wallet', async (req, res) => {
    try {
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
            balance
        });
        
    } catch (error: any) {
        console.error('[USDC BALANCE] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// USDC Transaction verification endpoint
app.get('/api/usdc/verify/:signature', async (req, res) => {
    try {
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
            verified
        });
        
    } catch (error: any) {
        console.error('[USDC VERIFY] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// TOLA Transfer endpoint
app.post('/api/tola/transfer', async (req, res) => {
    try {
        const body = req.body as TOLATransferRequest;
        
        if (!body.user_id || !body.wallet_address || !body.amount_tola) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        console.log('[TOLA TRANSFER] Request:', {
            user_id: body.user_id,
            wallet: body.wallet_address,
            amount: body.amount_tola
        });
        
        const result = await tolaService.transferTOLA(body);
        
        if (result.success) {
            console.log('[TOLA TRANSFER] Success:', result.signature);
            return res.status(200).json(result);
        } else {
            console.error('[TOLA TRANSFER] Failed:', result.error);
            return res.status(500).json(result);
        }
        
    } catch (error: any) {
        console.error('[TOLA TRANSFER] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// TOLA Balance endpoint
app.get('/api/tola/balance/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        if (!wallet) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address required'
            });
        }
        
        const balance = await tolaService.getBalance(wallet);
        
        return res.status(200).json({
            success: true,
            wallet,
            balance
        });
        
    } catch (error: any) {
        console.error('[TOLA BALANCE] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// TOLA Transaction verification endpoint
app.get('/api/tola/verify/:signature', async (req, res) => {
    try {
        const { signature } = req.params;
        
        if (!signature) {
            return res.status(400).json({
                success: false,
                error: 'Transaction signature required'
            });
        }
        
        const verified = await tolaService.verifyTransaction(signature);
        
        return res.status(200).json({
            success: true,
            signature,
            verified
        });
        
    } catch (error: any) {
        console.error('[TOLA VERIFY] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// ============================================
// NFT MINTING ENDPOINTS (v4.0.0)
// MUST be defined BEFORE app.listen()
// ============================================

// TOLA NFT Minting endpoint - Mints NFT and transfers to user wallet
app.post('/api/tola/mint-nft', async (req, res) => {
    try {
        const body = req.body as TOLANFTMintRequest & { recipient_wallet?: string };
        
        if (!body.name || !body.uri) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: name and uri'
            });
        }
        
        console.log('[TOLA NFT] Minting request:', {
            name: body.name,
            symbol: body.symbol,
            recipient: body.recipient_wallet || 'treasury',
            creators: body.creators?.length || 0
        });
        
        // Step 1: Mint NFT to treasury
        const mintResult = await nftService.mintNFT(body);
        
        if (!mintResult.success) {
            console.error('[TOLA NFT] Mint failed:', mintResult.error);
            return res.status(500).json(mintResult);
        }
        
        console.log('[TOLA NFT] Minted to treasury:', mintResult.mint_address);
        
        // Step 2: Transfer NFT to user's wallet if recipient provided
        if (body.recipient_wallet && mintResult.mint_address) {
            try {
                console.log('[TOLA NFT] Transferring to user wallet:', body.recipient_wallet);
                const transferResult = await nftService.transferNFT(
                    mintResult.mint_address,
                    body.recipient_wallet
                );
                
                if (transferResult.success) {
                    console.log('[TOLA NFT] Transfer successful:', transferResult.signature);
                    return res.status(200).json({
                        ...mintResult,
                        owner: body.recipient_wallet,
                        transfer_signature: transferResult.signature,
                        transfer_explorer_url: transferResult.explorer_url
                    });
                } else {
                    console.error('[TOLA NFT] Transfer failed:', transferResult.error);
                    // NFT minted but transfer failed - return partial success
                    return res.status(200).json({
                        ...mintResult,
                        owner: 'treasury',
                        transfer_status: 'pending',
                        transfer_error: transferResult.error
                    });
                }
            } catch (transferError: any) {
                console.error('[TOLA NFT] Transfer exception:', transferError);
                return res.status(200).json({
                    ...mintResult,
                    owner: 'treasury',
                    transfer_status: 'failed',
                    transfer_error: transferError.message
                });
            }
        }
        
        // No recipient specified - NFT stays in treasury
        console.log('[TOLA NFT] Minted (no transfer):', mintResult.mint_address);
        return res.status(200).json({
            ...mintResult,
            owner: 'treasury'
        });
        
    } catch (error: any) {
        console.error('[TOLA NFT] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// TOLA Metadata Upload endpoint - Uploads to Arweave via Bundlr
app.post('/api/tola/upload-metadata', async (req, res) => {
    try {
        const { name, symbol, description, image, attributes } = req.body;
        
        if (!name || !image) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: name and image'
            });
        }
        
        const metadata = {
            name,
            symbol: symbol || 'VRTX',
            description: description || '',
            image,
            attributes: attributes || [],
            properties: {
                files: [{ uri: image, type: 'image/png' }],
                category: 'image'
            }
        };
        
        console.log('[TOLA NFT] Uploading metadata to Arweave:', name);
        const uri = await nftService.uploadMetadata(metadata);
        
        console.log('[TOLA NFT] Metadata uploaded:', uri);
        return res.status(200).json({
            success: true,
            uri
        });
        
    } catch (error: any) {
        console.error('[TOLA NFT] Metadata upload error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// NFT Transfer endpoint - Transfer existing NFT to user
app.post('/api/tola/transfer-nft', async (req, res) => {
    try {
        const { mint_address, recipient_wallet } = req.body;
        
        if (!mint_address || !recipient_wallet) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: mint_address and recipient_wallet'
            });
        }
        
        console.log('[TOLA NFT] Transfer request:', { mint_address, recipient_wallet });
        
        const result = await nftService.transferNFT(mint_address, recipient_wallet);
        
        if (result.success) {
            console.log('[TOLA NFT] Transfer successful:', result.signature);
            return res.status(200).json(result);
        } else {
            console.error('[TOLA NFT] Transfer failed:', result.error);
            return res.status(500).json(result);
        }
        
    } catch (error: any) {
        console.error('[TOLA NFT] Transfer error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// NFT Lookup endpoint - Get NFT details by mint address
app.get('/api/tola/nft/:mint_address', async (req, res) => {
    try {
        const { mint_address } = req.params;
        
        if (!mint_address) {
            return res.status(400).json({
                success: false,
                error: 'Mint address required'
            });
        }
        
        const result = await nftService.getNFT(mint_address);
        
        return res.status(result.success ? 200 : 404).json(result);
        
    } catch (error: any) {
        console.error('[TOLA NFT] Lookup error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// NFT Minting webhook for WordPress
app.post('/wc/webhooks/nft-minted', (req, res) => {
    console.log('[WEBHOOK] NFT minted:', {
        user_id: req.body?.user_id,
        mint_address: req.body?.mint_address,
        title: req.body?.title
    });
    
    res.json({
        success: true,
        message: 'NFT mint webhook received'
    });
});

// ============================================
// SERVER START - Must be LAST
// ============================================

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`[VORTEX ENGINE] v4.1.0`);
    console.log(`[VORTEX ENGINE] USDC-First + AI Evolution`);
    console.log(`========================================\n`);
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health\n`);
    
    console.log(`USDC Payment System (User-Facing)`);
    console.log(`  POST /api/usdc/transfer - Transfer USDC to wallet`);
    console.log(`  GET  /api/usdc/balance/:wallet - Get USDC balance`);
    console.log(`  GET  /api/usdc/verify/:signature - Verify transaction\n`);
    
    console.log(`USDC Spending & Earning Tracking`);
    console.log(`  POST /api/spending/record - Record USDC spending`);
    console.log(`  POST /api/spending/earning - Record vendor earning (WCFM)`);
    console.log(`  GET  /api/spending/history/:user_id - Get spending history`);
    console.log(`  GET  /api/spending/summary/:user_id - Get spending summary`);
    console.log(`  GET  /api/spending/earnings/:user_id - Get vendor earnings`);
    console.log(`  POST /api/spending/webhook - WordPress webhook\n`);
    
    console.log(`NFT Swap System (Artists Only)`);
    console.log(`  POST /api/swap/execute - Execute single NFT swap`);
    console.log(`  POST /api/swap/execute-collection - Execute collection swap`);
    console.log(`  GET  /api/swap/verify/:swap_id - Verify swap status`);
    console.log(`  GET  /api/swap/fees - Get swap fee structure`);
    console.log(`  Fee: 5 USDC per user (10 USDC total)\n`);
    
    console.log(`TOLA-ART Masterpiece System (Daily at 00:00 Miami)`);
    console.log(`  POST /api/tola-masterpiece/distribute-royalty - Distribute royalties`);
    console.log(`  POST /api/tola-masterpiece/verify-secondary-sale - Verify sale`);
    console.log(`  GET  /api/tola-masterpiece/status - System status`);
    console.log(`  Minted on: TOLA (Solana) | Price: 900 USDC`);
    console.log(`  Royalties: 5% Platform + 15% Artists (20% on-chain)\n`);
    
    console.log(`TOLA Incentive System (Backend Only)`);
    console.log(`  POST /api/tola/transfer - Distribute TOLA rewards`);
    console.log(`  GET  /api/tola/balance/:wallet - Check TOLA incentives`);
    console.log(`  GET  /api/tola/verify/:signature - Verify TOLA TX\n`);
    
    console.log(`NFT Minting System`);
    console.log(`  POST /api/tola/mint-nft - Mint NFT and transfer to user`);
    console.log(`  POST /api/tola/upload-metadata - Upload metadata to Arweave`);
    console.log(`  POST /api/tola/transfer-nft - Transfer NFT to wallet`);
    console.log(`  GET  /api/tola/nft/:mint - Get NFT details\n`);
    
    console.log(`AI Evolution System (v4.1.0)`);
    console.log(`  Test-Time Scaling:`);
    console.log(`    POST /api/evolution/scaling/start - Start scaling session`);
    console.log(`    POST /api/evolution/scaling/complete - Complete session`);
    console.log(`    GET  /api/evolution/scaling/status - Get status`);
    console.log(`  Genetic Evolution:`);
    console.log(`    POST /api/evolution/genetic/update - Update population`);
    console.log(`    POST /api/evolution/genetic/fitness - Record fitness`);
    console.log(`    GET  /api/evolution/genetic/status - Get status`);
    console.log(`  Open Model Hub:`);
    console.log(`    POST /api/evolution/models/discovered - Record discovery`);
    console.log(`    POST /api/evolution/models/integrate - Integrate technique`);
    console.log(`    GET  /api/evolution/models/status - Get status`);
    console.log(`  Real-Time Thinking:`);
    console.log(`    POST /api/evolution/thinking/record - Record session`);
    console.log(`    GET  /api/evolution/thinking/status - Get status`);
    console.log(`  Training Observatory:`);
    console.log(`    POST /api/evolution/observatory/metric - Record metric`);
    console.log(`    GET  /api/evolution/observatory/levels - Training levels`);
    console.log(`    GET  /api/evolution/observatory/metrics - Aggregated metrics`);
    console.log(`  GET  /api/evolution/status - Full system status\n`);
    
    console.log(`Agentic AI System (v4.0.0)`);
    console.log(`  Intelligent Routing:`);
    console.log(`    POST /api/agentic/route - Route request to optimal agent`);
    console.log(`    POST /api/agentic/classify - Classify intent from prompt`);
    console.log(`    GET  /api/agentic/agents - Get available agents`);
    console.log(`    POST /api/agentic/execute - Execute with selected agent`);
    console.log(`  NVIDIA Integration:`);
    console.log(`    POST /api/agentic/nvidia/chat - Chat with Nemotron models`);
    console.log(`    POST /api/agentic/nvidia/embed - Generate embeddings`);
    console.log(`    GET  /api/agentic/nvidia/models - Get NVIDIA models`);
    console.log(`  Unified Pipeline:`);
    console.log(`    POST /api/agentic/pipeline/execute - Execute full pipeline`);
    console.log(`    GET  /api/agentic/pipeline/status - Get pipeline status`);
    console.log(`    POST /api/agentic/webhook/wordpress - WordPress webhook\n`);
    
    console.log(`Cosmos AI System (v4.0.0) - SECRET SAUCE`);
    console.log(`  Robot Management:`);
    console.log(`    POST /api/cosmos/robot/:id/connect - Connect robot`);
    console.log(`    POST /api/cosmos/robot/:id/heartbeat - Robot heartbeat`);
    console.log(`    POST /api/cosmos/robot/:id/disconnect - Disconnect robot`);
    console.log(`    GET  /api/cosmos/robot/:id/status - Get robot status`);
    console.log(`  Robot Commands:`);
    console.log(`    POST /api/cosmos/robot/:id/command - Send command`);
    console.log(`    POST /api/cosmos/robot/:id/sensor - Receive sensor data`);
    console.log(`    POST /api/cosmos/robot/:id/speak - Speech synthesis`);
    console.log(`    POST /api/cosmos/robot/:id/move - Movement commands`);
    console.log(`    POST /api/cosmos/robot/:id/create - Art creation`);
    console.log(`  User Data:`);
    console.log(`    GET  /api/cosmos/user/:id/export - Export user profile`);
    console.log(`  Transactions:`);
    console.log(`    POST /api/cosmos/transaction/initiate - Start transaction`);
    console.log(`    POST /api/cosmos/transaction/:id/confirm - Confirm\n`);
    
    console.log(`WordPress Webhooks:`);
    console.log(`  POST /wc/webhooks/wallet-connected`);
    console.log(`  POST /wc/webhooks/subscription-activated`);
    console.log(`  POST /wc/webhooks/usage-payment (USDC)`);
    console.log(`  POST /wc/webhooks/order-created`);
    console.log(`  POST /wc/webhooks/order-paid`);
    console.log(`  POST /wc/webhooks/product-published`);
    console.log(`  POST /wc/webhooks/nft-minted`);
    console.log(`  POST /api/swap/webhook/completed`);
    console.log(`  POST /api/tola-masterpiece/webhook/created`);
    console.log(`  POST /api/tola-masterpiece/webhook/sold`);
    console.log(`  POST /api/evolution/webhook/wordpress - Evolution updates\n`);
    
    console.log(`Blockchain:`);
    console.log(`  Network: ${process.env.SOLANA_NETWORK || 'mainnet-beta'}`);
    console.log(`  USDC Mint: ${process.env.USDC_MINT?.substring(0, 20) || 'not set'}...`);
    console.log(`  TOLA Mint: ${process.env.TOLA_MINT?.substring(0, 20) || 'not set'}...`);
    console.log(`  Treasury: ${process.env.TREASURY_WALLET_PUBLIC?.substring(0, 20) || 'not set'}...\n`);
    
    console.log(`All systems operational - Ready for requests\n`);
});
