/**
 * Vortex Engine - TOLA x WooCommerce x Solana Integration
 * 
 * Main server entry point
 * @version 1.0.0
 */

import express, { Application } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { tolaRoutes } from './routes/tola.routes';
import { wooCommerceRoutes } from './routes/woocommerce.routes';
import { assetsRoutes } from './routes/assets.routes';
import { errorHandler } from './middleware/error.middleware';
import { rateLimiter } from './middleware/rate-limit.middleware';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        process.env.WOO_BASE_URL || '',
        'https://wordpress-1516791-5894715.cloudwaysapps.com',
        'http://localhost:3000'
    ],
    credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting
app.use(rateLimiter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'vortex-engine',
        version: '1.0.0'
    });
});

// Routes
app.use('/tola', tolaRoutes);
app.use('/wc', wooCommerceRoutes);
app.use('/assets', assetsRoutes);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    logger.info(`[VORTEX ENGINE] Server running on port ${PORT}`);
    logger.info(`[VORTEX ENGINE] Environment: ${process.env.NODE_ENV}`);
    logger.info(`[VORTEX ENGINE] TOLA Mint: ${process.env.TOLA_MINT}`);
    logger.info(`[VORTEX ENGINE] Treasury: ${process.env.PLATFORM_TREASURY_PUBKEY}`);
});

export default app;

