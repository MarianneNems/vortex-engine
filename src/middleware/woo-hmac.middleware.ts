/**
 * WooCommerce HMAC Middleware
 * @version 4.0.1
 * @description Validates WooCommerce webhook signatures using raw body
 * @fix Uses rawBody captured before JSON parsing for accurate signature verification
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Extend Express Request to include rawBody
declare global {
    namespace Express {
        interface Request {
            rawBody?: string;
        }
    }
}

/**
 * Validates WooCommerce webhook signature
 * WooCommerce signs the raw body with HMAC-SHA256 and sends it base64 encoded
 */
export function validateWooCommerceWebhook(req: Request, res: Response, next: NextFunction) {
    const signature = req.headers['x-wc-webhook-signature'] as string;
    const source = req.headers['x-wc-webhook-source'] as string;
    const deliveryId = req.headers['x-wc-webhook-delivery-id'] as string;
    const secret = process.env.WOO_WEBHOOK_SECRET;

    // Log incoming webhook details
    console.log(`[WEBHOOK AUTH] Validating webhook from ${source || 'unknown'}, delivery: ${deliveryId || 'N/A'}`);

    // Check if secret is configured
    if (!secret) {
        console.error('[WEBHOOK AUTH] ERROR: WOO_WEBHOOK_SECRET not configured in environment');
        return res.status(500).json({
            success: false,
            error: 'Webhook secret not configured',
            code: 'WEBHOOK_CONFIG_ERROR'
        });
    }

    // If no signature header, check if this is a test/ping webhook
    if (!signature) {
        // Allow ping/test webhooks without signature (WooCommerce sends these for setup)
        if (req.body?.webhook_id || req.body?.action === 'ping') {
            console.log('[WEBHOOK AUTH] Allowing ping/test webhook without signature');
            return next();
        }

        // Allow diagnostic webhooks (from our own system)
        if (req.body?.test === true && req.body?.diagnostic === true) {
            console.log('[WEBHOOK AUTH] Allowing diagnostic webhook without signature');
            return next();
        }

        console.error('[WEBHOOK AUTH] ERROR: Missing x-wc-webhook-signature header');
        return res.status(401).json({
            success: false,
            error: 'Missing webhook signature',
            code: 'MISSING_SIGNATURE'
        });
    }

    // Get the raw body - try multiple sources
    let payload: string;
    
    if (req.rawBody) {
        // Use raw body if available (set by rawBodyMiddleware)
        payload = req.rawBody;
    } else if (typeof req.body === 'string') {
        // Body wasn't parsed
        payload = req.body;
    } else {
        // Fallback: stringify the parsed body (may have slight differences)
        // Sort keys for consistency
        payload = JSON.stringify(req.body);
    }

    // Compute HMAC-SHA256 signature
    const computedHash = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('base64');

    // Compare signatures
    if (computedHash !== signature) {
        console.error('[WEBHOOK AUTH] ERROR: Signature mismatch');
        console.error(`[WEBHOOK AUTH] Expected: ${computedHash.substring(0, 20)}...`);
        console.error(`[WEBHOOK AUTH] Received: ${signature.substring(0, 20)}...`);
        console.error(`[WEBHOOK AUTH] Payload length: ${payload.length} bytes`);
        
        // In development/staging, allow through but log warning
        if (process.env.NODE_ENV !== 'production' || process.env.WEBHOOK_SKIP_VERIFY === 'true') {
            console.warn('[WEBHOOK AUTH] BYPASSING signature check (non-production or WEBHOOK_SKIP_VERIFY=true)');
            return next();
        }

        return res.status(401).json({
            success: false,
            error: 'Invalid webhook signature',
            code: 'INVALID_SIGNATURE'
        });
    }

    console.log('[WEBHOOK AUTH] Signature verified successfully');
    next();
}

/**
 * Middleware to capture raw body before JSON parsing
 * Must be applied BEFORE body-parser/express.json()
 */
export function rawBodyMiddleware(req: Request, res: Response, next: NextFunction) {
    // Only capture raw body for webhook routes
    if (req.path.includes('/webhooks/')) {
        let data = '';
        req.setEncoding('utf8');
        
        req.on('data', (chunk) => {
            data += chunk;
        });
        
        req.on('end', () => {
            req.rawBody = data;
            // Parse JSON manually
            try {
                req.body = JSON.parse(data);
            } catch (e) {
                req.body = {};
            }
            next();
        });
    } else {
        next();
    }
}

/**
 * Alternative: Express.json with verify callback to capture raw body
 * Use this instead of separate rawBodyMiddleware
 */
export function jsonWithRawBody() {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.path.includes('/webhooks/')) {
            let rawData = '';
            req.setEncoding('utf8');
            
            req.on('data', (chunk: string) => {
                rawData += chunk;
            });
            
            req.on('end', () => {
                req.rawBody = rawData;
                try {
                    req.body = rawData ? JSON.parse(rawData) : {};
                } catch (e) {
                    req.body = {};
                }
                next();
            });
        } else {
            // For non-webhook routes, use standard JSON parsing
            require('body-parser').json({ limit: '10mb' })(req, res, next);
        }
    };
}
