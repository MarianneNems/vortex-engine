/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitConfig {
    windowMs: number;      // Time window in milliseconds
    maxRequests: number;   // Maximum requests per window
    message?: string;      // Custom error message
    skipSuccessfulRequests?: boolean;
    keyGenerator?: (req: Request) => string;
}

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

// In-memory store (use Redis in production)
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
        if (entry.resetTime < now) {
            rateLimitStore.delete(key);
        }
    }
}, 60000); // Clean up every minute

/**
 * Default key generator - uses IP address
 */
const defaultKeyGenerator = (req: Request): string => {
    return req.ip || 
           req.headers['x-forwarded-for'] as string || 
           req.socket.remoteAddress || 
           'unknown';
};

/**
 * Create rate limiter middleware
 */
export const createRateLimiter = (config: RateLimitConfig) => {
    const {
        windowMs = 60000,
        maxRequests = 100,
        message = 'Too many requests, please try again later.',
        skipSuccessfulRequests = false,
        keyGenerator = defaultKeyGenerator
    } = config;

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = keyGenerator(req);
        const now = Date.now();

        // Get or create entry
        let entry = rateLimitStore.get(key);
        
        if (!entry || entry.resetTime < now) {
            entry = {
                count: 0,
                resetTime: now + windowMs
            };
        }

        entry.count++;
        rateLimitStore.set(key, entry);

        // Set rate limit headers
        const remaining = Math.max(0, maxRequests - entry.count);
        const reset = Math.ceil(entry.resetTime / 1000);

        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', reset);

        // Check if limit exceeded
        if (entry.count > maxRequests) {
            logger.warn(`[Rate Limit] Exceeded for ${key}: ${entry.count}/${maxRequests}`);
            
            res.status(429).json({
                success: false,
                error: 'rate_limit_exceeded',
                message,
                retry_after: Math.ceil((entry.resetTime - now) / 1000)
            });
            return;
        }

        // Handle successful request tracking
        if (skipSuccessfulRequests) {
            res.on('finish', () => {
                if (res.statusCode < 400) {
                    entry!.count--;
                    rateLimitStore.set(key, entry!);
                }
            });
        }

        next();
    };
};

/**
 * Pre-configured rate limiters
 */

// General API rate limiter (100 requests per minute)
export const apiRateLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 100,
    message: 'Too many API requests. Please wait a moment.'
});

// Strict rate limiter for sensitive endpoints (10 requests per minute)
export const strictRateLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 10,
    message: 'Rate limit exceeded for this action.'
});

// Transfer rate limiter (5 transfers per minute)
export const transferRateLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 5,
    message: 'Too many transfer requests. Please wait.'
});

// Webhook rate limiter (1000 requests per minute)
export const webhookRateLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 1000,
    message: 'Webhook rate limit exceeded.'
});

/**
 * User-specific rate limiter
 * Limits based on user_id instead of IP
 */
export const userRateLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 50,
    keyGenerator: (req) => {
        const userId = req.body?.user_id || req.query?.user_id || 'anonymous';
        return `user:${userId}`;
    },
    message: 'Too many requests for this user. Please wait.'
});
