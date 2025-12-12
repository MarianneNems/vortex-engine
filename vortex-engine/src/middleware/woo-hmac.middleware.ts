/**
 * WooCommerce HMAC Validation Middleware
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const WOO_WEBHOOK_SECRET = process.env.WOO_WEBHOOK_SECRET || '';

/**
 * Validate WooCommerce webhook HMAC signature
 */
export function validateWooHMAC(req: Request, res: Response, next: NextFunction) {
    try {
        const signature = req.headers['x-wc-webhook-signature'] as string;
        
        if (!signature) {
            logger.warn('[WOO HMAC] No signature provided');
            return res.status(401).json({
                success: false,
                error: 'Missing webhook signature'
            });
        }
        
        // Calculate expected signature
        const payload = JSON.stringify(req.body);
        const expectedSignature = crypto
            .createHmac('sha256', WOO_WEBHOOK_SECRET)
            .update(payload)
            .digest('base64');
        
        // Compare signatures
        if (signature !== expectedSignature) {
            logger.warn('[WOO HMAC] Invalid signature');
            return res.status(401).json({
                success: false,
                error: 'Invalid webhook signature'
            });
        }
        
        logger.info('[WOO HMAC] Signature validated');
        next();
        
    } catch (error) {
        logger.error('[WOO HMAC] Validation error:', error);
        return res.status(500).json({
            success: false,
            error: 'HMAC validation failed'
        });
    }
}

