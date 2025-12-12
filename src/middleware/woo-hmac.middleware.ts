import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function validateWooCommerceWebhook(req: Request, res: Response, next: NextFunction) {
    const signature = req.headers['x-wc-webhook-signature'] as string;
    const secret = process.env.WOO_WEBHOOK_SECRET;

    if (!secret) {
        console.error('[WEBHOOK] WOO_WEBHOOK_SECRET not configured');
        return res.status(500).json({
            success: false,
            error: 'Webhook secret not configured'
        });
    }

    if (!signature) {
        return res.status(401).json({
            success: false,
            error: 'Missing webhook signature'
        });
    }

    const payload = JSON.stringify(req.body);
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64');

    if (hash !== signature) {
        return res.status(401).json({
            success: false,
            error: 'Invalid webhook signature'
        });
    }

    next();
}
