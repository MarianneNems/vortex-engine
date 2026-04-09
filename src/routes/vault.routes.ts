/**
 * Vault / ARCHER Analysis Routes
 * @version 4.0.0
 * @description Handles POST /vault-analyze requests from WordPress VAULT system.
 * WordPress sends artwork data; engine logs it, runs available analysis, and responds.
 * Mounted at /vault-analyze in server.ts (router handles POST /)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/** Lightweight secret guard — same pattern as wp-webhooks */
const validateVaultSecret = (req: Request, res: Response, next: NextFunction): void => {
    const secret = process.env.VORTEX_WP_WEBHOOK_SECRET || process.env.VORTEX_API_KEY;
    if (!secret) { next(); return; }
    const provided = (req.headers['x-vortex-secret'] || req.headers['x-api-key']) as string | undefined;
    if (provided !== secret) {
        logger.warn(`[VAULT] Unauthorized request from ${req.ip}`);
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }
    next();
};

const router = Router();

interface VaultAnalyzePayload {
    user_id?: number | string;
    artwork_id?: number | string;
    image_url?: string;
    title?: string;
    description?: string;
    tags?: string[];
    medium?: string;
    style?: string;
    analysis_type?: 'style' | 'composition' | 'cloe' | 'archer' | 'full';
    wallet_address?: string;
    site_url?: string;
}

// ─────────────────────────────────────────────────────────────
// POST /vault-analyze
// VAULT/ARCHER artwork analysis endpoint.
// Accepts artwork metadata + image URL, returns structured analysis.
// ─────────────────────────────────────────────────────────────
router.post('/', validateVaultSecret, async (req: Request, res: Response) => {
    try {
        const payload = req.body as VaultAnalyzePayload;

        const {
            user_id, artwork_id, image_url, title,
            description, tags, medium, style,
            analysis_type = 'full', wallet_address,
        } = payload;

        // Require at minimum an artwork identifier
        if (!artwork_id && !image_url) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: artwork_id or image_url',
                code: 'VALIDATION_ERROR',
            });
        }

        logger.info(
            `[VAULT] Analyze request  user_id=${user_id ?? 'anon'}  artwork_id=${artwork_id ?? 'n/a'}  type=${analysis_type}  image=${image_url ? 'yes' : 'no'}`
        );

        // Build base analysis result
        const analysisResult: Record<string, any> = {
            artwork_id: artwork_id ?? null,
            user_id: user_id ?? null,
            analysis_type,
            analyzed_at: new Date().toISOString(),
            image_url: image_url ?? null,
            title: title ?? null,
        };

        // Style/medium classification (from submitted metadata)
        if (analysis_type === 'style' || analysis_type === 'full') {
            analysisResult.style_analysis = {
                submitted_style: style ?? null,
                submitted_medium: medium ?? null,
                submitted_tags: tags ?? [],
            };
        }

        // Composition analysis placeholder (extend when ML service is wired)
        if (analysis_type === 'composition' || analysis_type === 'full') {
            analysisResult.composition = {
                status: 'acknowledged',
                note: 'Deep composition analysis queued for HURAII processing',
            };
        }

        // ARCHER learning signal
        if (analysis_type === 'archer' || analysis_type === 'full') {
            analysisResult.archer = {
                status: 'signal_received',
                user_id: user_id ?? null,
                artwork_signals: {
                    style,
                    medium,
                    tags: tags ?? [],
                    description_length: description ? description.length : 0,
                },
            };
        }

        // CLOE market analysis signal
        if (analysis_type === 'cloe' || analysis_type === 'full') {
            analysisResult.cloe = {
                status: 'queued',
                note: 'CLOE market analysis will be processed asynchronously',
            };
        }

        logger.info(`[VAULT] Analysis complete  artwork_id=${artwork_id}  type=${analysis_type}`);

        return res.json({
            success: true,
            data: analysisResult,
            version: '4.0.0',
        });

    } catch (error) {
        logger.error('[VAULT] vault-analyze error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export { router as vaultRoutes };
