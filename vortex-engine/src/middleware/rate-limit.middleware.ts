/**
 * Rate Limiting Middleware
 */

import { Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';
import { logger } from '../utils/logger';

const cache = new NodeCache();
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100');
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '900000'); // 15 min

/**
 * Rate limiter middleware
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `rate_limit_${ip}`;
    
    const current = cache.get(key) as number || 0;
    
    if (current >= RATE_LIMIT_MAX) {
        logger.warn(`[RATE LIMIT] Exceeded for IP: ${ip}`);
        return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded. Please try again later.'
        });
    }
    
    cache.set(key, current + 1, RATE_LIMIT_WINDOW / 1000);
    
    next();
}

