/**
 * Vortex Engine - TOLA x WooCommerce x Solana Integration
image.png * Minimal working version v4.0.0
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

app.listen(PORT, () => {
    console.log(`[VORTEX ENGINE] v4.0.0 listening on port ${PORT}`);
    console.log(`[VORTEX ENGINE] Health check: http://localhost:${PORT}/health`);
    console.log(`[VORTEX ENGINE] Webhooks active:`);
    console.log(`  - /wc/webhooks/wallet-connected`);
    console.log(`  - /wc/webhooks/tola-transaction`);
    console.log(`  - /wc/webhooks/subscription-activated`);
    console.log(`  - /wc/webhooks/collector-subscription`);
});
