/**
 * Vortex Engine - TOLA x WooCommerce x Solana Integration
 * Minimal working version v4.0.0
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

app.listen(PORT, () => {
    console.log(`[VORTEX ENGINE] v4.0.0 listening on port ${PORT}`);
    console.log(`[VORTEX ENGINE] Health check: http://localhost:${PORT}/health`);
});
