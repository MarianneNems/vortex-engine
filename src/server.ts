/**
 * Vortex Engine - TOLA x WooCommerce x Solana Integration
 * Minimal working version v4.0.0 with USDC support
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { USDCTransferService, USDCTransferRequest } from './services/usdc-transfer.service';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Initialize USDC service
const usdcService = new USDCTransferService();

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

app.listen(PORT, () => {
    console.log(`[VORTEX ENGINE] v4.0.0 listening on port ${PORT}`);
    console.log(`[VORTEX ENGINE] Health check: http://localhost:${PORT}/health`);
    console.log(`[VORTEX ENGINE] Webhooks active:`);
    console.log(`  - /wc/webhooks/wallet-connected (Wallet connections)`);
    console.log(`  - /wc/webhooks/tola-transaction (TOLA purchases/transfers)`);
    console.log(`  - /wc/webhooks/subscription-activated (Monthly subscriptions)`);
    console.log(`  - /wc/webhooks/collector-subscription (Collector tier)`);
    console.log(`  - /wc/webhooks/usage-payment (AI generation billing)`);
    console.log(`  - /wc/webhooks/order-created (WooCommerce orders)`);
    console.log(`  - /wc/webhooks/order-paid (Payment completions)`);
    console.log(`  - /wc/webhooks/product-published (Product publishing)`);
    console.log(`[VORTEX ENGINE] USDC API endpoints:`);
    console.log(`  - POST /api/usdc/transfer (Transfer USDC to wallet)`);
    console.log(`  - GET /api/usdc/balance/:wallet (Get USDC balance)`);
    console.log(`  - GET /api/usdc/verify/:signature (Verify transaction)`);
});
