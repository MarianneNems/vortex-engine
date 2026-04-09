/**
 * WordPress Native Webhook Routes
 * @version 4.0.0
 * @description Handles user lifecycle events pushed from WordPress (user-login, user-registered, user-updated)
 * Mounted at /wp
 */

import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Optional secret validation — enforced only when VORTEX_WP_WEBHOOK_SECRET is set.
 * WordPress sends it via X-Vortex-Secret header (configured in the mu-plugin).
 */
const validateWpSecret = (req: Request, res: Response, next: NextFunction): void => {
    const secret = process.env.VORTEX_WP_WEBHOOK_SECRET;
    if (!secret) { next(); return; }

    const provided = (
        req.headers['x-vortex-secret'] ||
        req.headers['x-wp-webhook-secret'] ||
        (req.body as any)?.webhook_secret
    ) as string | undefined;

    if (provided !== secret) {
        logger.warn(`[WP Webhook] Invalid or missing secret from ${req.ip} on ${req.path}`);
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }
    next();
};

// ─────────────────────────────────────────────────────────────
// POST /wp/webhooks/user-login
// WordPress fires this on every successful login.
// Useful for: session tracking, ARCHER warm-up, activity pulse.
// ─────────────────────────────────────────────────────────────
router.post('/webhooks/user-login', validateWpSecret, async (req: Request, res: Response) => {
    try {
        const {
            user_id, user_login, user_email,
            wallet_address,
        } = req.body as Record<string, any>;

        logger.info(`[WP] user-login  user_id=${user_id}  login=${user_login}  email=${user_email}`);

        res.json({
            success: true,
            event: 'user-login',
            user_id: user_id ?? null,
            received_at: new Date().toISOString(),
        });

    } catch (error) {
        logger.error('[WP] user-login webhook error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /wp/webhooks/user-registered
// WordPress fires this when a new user completes registration.
// Useful for: onboarding pipeline, welcome TOLA credits, ARCHER init.
// ─────────────────────────────────────────────────────────────
router.post('/webhooks/user-registered', validateWpSecret, async (req: Request, res: Response) => {
    try {
        const {
            user_id, user_login, user_email, display_name,
            role, wallet_address,
        } = req.body as Record<string, any>;

        logger.info(
            `[WP] user-registered  user_id=${user_id}  email=${user_email}  role=${role}  wallet=${wallet_address ?? 'none'}`
        );

        res.json({
            success: true,
            event: 'user-registered',
            user_id: user_id ?? null,
            received_at: new Date().toISOString(),
        });

    } catch (error) {
        logger.error('[WP] user-registered webhook error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /wp/webhooks/user-updated
// WordPress fires this whenever a user profile is saved
// (profile edit, role change, wallet connect, meta update).
// Useful for: wallet sync, role-gating updates, balance refresh.
// ─────────────────────────────────────────────────────────────
router.post('/webhooks/user-updated', validateWpSecret, async (req: Request, res: Response) => {
    try {
        const {
            user_id, user_email, display_name,
            role, wallet_address,
        } = req.body as Record<string, any>;

        logger.info(
            `[WP] user-updated  user_id=${user_id}  wallet=${wallet_address ?? 'none'}  role=${role ?? 'unchanged'}`
        );

        res.json({
            success: true,
            event: 'user-updated',
            user_id: user_id ?? null,
            received_at: new Date().toISOString(),
        });

    } catch (error) {
        logger.error('[WP] user-updated webhook error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export { router as wpWebhookRoutes };
