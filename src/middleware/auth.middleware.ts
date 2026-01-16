/**
 * Authentication Middleware
 * Validates API requests using API key or JWT
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            userId?: number;
            userRole?: string;
            apiKey?: string;
        }
    }
}

/**
 * API Key authentication middleware
 * Checks for valid API key in headers
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Get API key from headers
        const apiKey = req.headers['x-api-key'] as string || 
                       req.headers['authorization']?.replace('Bearer ', '');
        
        // Check if API key is present
        if (!apiKey) {
            res.status(401).json({
                success: false,
                error: 'Missing API key',
                message: 'Please provide API key in x-api-key header or Authorization bearer token'
            });
            return;
        }
        
        // Validate API key
        const validApiKey = process.env.VORTEX_API_KEY;
        const validAdminKey = process.env.VORTEX_ADMIN_API_KEY;
        
        if (apiKey === validApiKey || apiKey === validAdminKey) {
            req.apiKey = apiKey;
            req.userRole = apiKey === validAdminKey ? 'admin' : 'user';
            next();
            return;
        }
        
        // Invalid API key
        logger.warn(`[Auth] Invalid API key attempt: ${apiKey.substring(0, 8)}...`);
        
        res.status(403).json({
            success: false,
            error: 'Invalid API key',
            message: 'The provided API key is not valid'
        });
        
    } catch (error: any) {
        logger.error('[Auth] Authentication error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication error',
            message: error.message
        });
    }
};

/**
 * Admin-only authentication middleware
 */
export const adminAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const apiKey = req.headers['x-api-key'] as string || 
                       req.headers['authorization']?.replace('Bearer ', '');
        
        if (!apiKey) {
            res.status(401).json({
                success: false,
                error: 'Missing API key'
            });
            return;
        }
        
        const validAdminKey = process.env.VORTEX_ADMIN_API_KEY;
        
        if (apiKey !== validAdminKey) {
            res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
            return;
        }
        
        req.apiKey = apiKey;
        req.userRole = 'admin';
        next();
        
    } catch (error: any) {
        logger.error('[Auth] Admin auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication error'
        });
    }
};

/**
 * Optional authentication - sets user info if available but doesn't require it
 */
export const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const apiKey = req.headers['x-api-key'] as string || 
                       req.headers['authorization']?.replace('Bearer ', '');
        
        if (apiKey) {
            const validApiKey = process.env.VORTEX_API_KEY;
            const validAdminKey = process.env.VORTEX_ADMIN_API_KEY;
            
            if (apiKey === validApiKey || apiKey === validAdminKey) {
                req.apiKey = apiKey;
                req.userRole = apiKey === validAdminKey ? 'admin' : 'user';
            }
        }
        
        next();
        
    } catch (error: any) {
        // Don't fail on optional auth errors
        next();
    }
};

/**
 * WordPress user ID extraction middleware
 * Extracts user_id from request body or query params
 */
export const wpUserMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Extract user_id from various sources
        const userId = req.body?.user_id || 
                       req.query?.user_id ||
                       req.headers['x-wp-user-id'];
        
        if (userId) {
            req.userId = parseInt(userId as string, 10);
        }
        
        next();
        
    } catch (error) {
        next();
    }
};
