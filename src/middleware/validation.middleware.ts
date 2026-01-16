/**
 * Validation Middleware - Production Grade
 * Input validation and sanitization for API requests
 * 
 * Features:
 * - Schema-based validation
 * - Type coercion
 * - Sanitization
 * - Custom validators
 * - Error formatting
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Validation types
type ValidationType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'wallet' | 'signature' | 'uri' | 'email';

interface ValidationRule {
    type: ValidationType;
    required?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    enum?: any[];
    default?: any;
    custom?: (value: any) => boolean | string;
    sanitize?: (value: any) => any;
}

interface ValidationSchema {
    [field: string]: ValidationRule;
}

interface ValidationError {
    field: string;
    message: string;
    value?: any;
}

// Solana address regex
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_REGEX = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URI_REGEX = /^(https?:\/\/|ipfs:\/\/|ar:\/\/).+$/;

/**
 * Validate a single value against a rule
 */
function validateValue(value: any, rule: ValidationRule, fieldName: string): ValidationError | null {
    // Handle required
    if (rule.required && (value === undefined || value === null || value === '')) {
        return { field: fieldName, message: `${fieldName} is required` };
    }

    // Skip validation if not required and empty
    if (!rule.required && (value === undefined || value === null)) {
        return null;
    }

    // Type validation
    switch (rule.type) {
        case 'string':
            if (typeof value !== 'string') {
                return { field: fieldName, message: `${fieldName} must be a string`, value };
            }
            if (rule.minLength && value.length < rule.minLength) {
                return { field: fieldName, message: `${fieldName} must be at least ${rule.minLength} characters`, value };
            }
            if (rule.maxLength && value.length > rule.maxLength) {
                return { field: fieldName, message: `${fieldName} must be at most ${rule.maxLength} characters`, value };
            }
            if (rule.pattern && !rule.pattern.test(value)) {
                return { field: fieldName, message: `${fieldName} has invalid format`, value };
            }
            break;

        case 'number':
            const num = typeof value === 'string' ? parseFloat(value) : value;
            if (isNaN(num)) {
                return { field: fieldName, message: `${fieldName} must be a number`, value };
            }
            if (rule.min !== undefined && num < rule.min) {
                return { field: fieldName, message: `${fieldName} must be at least ${rule.min}`, value };
            }
            if (rule.max !== undefined && num > rule.max) {
                return { field: fieldName, message: `${fieldName} must be at most ${rule.max}`, value };
            }
            break;

        case 'boolean':
            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                return { field: fieldName, message: `${fieldName} must be a boolean`, value };
            }
            break;

        case 'array':
            if (!Array.isArray(value)) {
                return { field: fieldName, message: `${fieldName} must be an array`, value };
            }
            if (rule.min !== undefined && value.length < rule.min) {
                return { field: fieldName, message: `${fieldName} must have at least ${rule.min} items`, value };
            }
            if (rule.max !== undefined && value.length > rule.max) {
                return { field: fieldName, message: `${fieldName} must have at most ${rule.max} items`, value };
            }
            break;

        case 'object':
            if (typeof value !== 'object' || Array.isArray(value) || value === null) {
                return { field: fieldName, message: `${fieldName} must be an object`, value };
            }
            break;

        case 'wallet':
            if (typeof value !== 'string' || !SOLANA_ADDRESS_REGEX.test(value)) {
                return { field: fieldName, message: `${fieldName} must be a valid Solana wallet address`, value };
            }
            break;

        case 'signature':
            if (typeof value !== 'string' || !SOLANA_SIGNATURE_REGEX.test(value)) {
                return { field: fieldName, message: `${fieldName} must be a valid Solana transaction signature`, value };
            }
            break;

        case 'uri':
            if (typeof value !== 'string' || !URI_REGEX.test(value)) {
                return { field: fieldName, message: `${fieldName} must be a valid URI (https://, ipfs://, or ar://)`, value };
            }
            break;

        case 'email':
            if (typeof value !== 'string' || !EMAIL_REGEX.test(value)) {
                return { field: fieldName, message: `${fieldName} must be a valid email address`, value };
            }
            break;
    }

    // Enum validation
    if (rule.enum && !rule.enum.includes(value)) {
        return { field: fieldName, message: `${fieldName} must be one of: ${rule.enum.join(', ')}`, value };
    }

    // Custom validation
    if (rule.custom) {
        const result = rule.custom(value);
        if (result !== true) {
            return { 
                field: fieldName, 
                message: typeof result === 'string' ? result : `${fieldName} failed custom validation`,
                value 
            };
        }
    }

    return null;
}

/**
 * Apply default values and sanitization
 */
function processValue(value: any, rule: ValidationRule): any {
    // Apply default if undefined
    if ((value === undefined || value === null) && rule.default !== undefined) {
        return rule.default;
    }

    // Type coercion
    if (value !== undefined && value !== null) {
        switch (rule.type) {
            case 'number':
                value = typeof value === 'string' ? parseFloat(value) : value;
                break;
            case 'boolean':
                if (value === 'true') value = true;
                if (value === 'false') value = false;
                break;
        }
    }

    // Apply sanitization
    if (rule.sanitize && value !== undefined && value !== null) {
        value = rule.sanitize(value);
    }

    return value;
}

/**
 * Create validation middleware for body
 */
export function validateBody(schema: ValidationSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: ValidationError[] = [];
        const sanitized: Record<string, any> = {};

        for (const [field, rule] of Object.entries(schema)) {
            const value = req.body[field];
            
            // Validate
            const error = validateValue(value, rule, field);
            if (error) {
                errors.push(error);
            } else {
                // Process (defaults and sanitization)
                sanitized[field] = processValue(value, rule);
            }
        }

        if (errors.length > 0) {
            res.status(400).json({
                success: false,
                error: 'Validation failed',
                code: 'VALIDATION_ERROR',
                details: errors,
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Replace body with sanitized values
        req.body = { ...req.body, ...sanitized };
        next();
    };
}

/**
 * Create validation middleware for query params
 */
export function validateQuery(schema: ValidationSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: ValidationError[] = [];
        const sanitized: Record<string, any> = {};

        for (const [field, rule] of Object.entries(schema)) {
            const value = req.query[field];
            
            const error = validateValue(value, rule, field);
            if (error) {
                errors.push(error);
            } else {
                sanitized[field] = processValue(value, rule);
            }
        }

        if (errors.length > 0) {
            res.status(400).json({
                success: false,
                error: 'Query validation failed',
                code: 'VALIDATION_ERROR',
                details: errors,
                timestamp: new Date().toISOString()
            });
            return;
        }

        req.query = { ...req.query, ...sanitized } as any;
        next();
    };
}

/**
 * Create validation middleware for path params
 */
export function validateParams(schema: ValidationSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: ValidationError[] = [];

        for (const [field, rule] of Object.entries(schema)) {
            const value = req.params[field];
            const error = validateValue(value, rule, field);
            if (error) {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            res.status(400).json({
                success: false,
                error: 'Path parameter validation failed',
                code: 'VALIDATION_ERROR',
                details: errors,
                timestamp: new Date().toISOString()
            });
            return;
        }

        next();
    };
}

// Pre-built schemas for common operations
export const schemas = {
    // USDC Transfer
    usdcTransfer: {
        user_id: { type: 'number' as ValidationType, required: true, min: 1 },
        wallet_address: { type: 'wallet' as ValidationType, required: true },
        amount_usdc: { type: 'number' as ValidationType, required: true, min: 0.000001 },
        order_id: { type: 'string' as ValidationType, required: false, maxLength: 100 },
        reference: { type: 'string' as ValidationType, required: false, maxLength: 200 }
    },

    // TOLA Transfer  
    tolaTransfer: {
        user_id: { type: 'number' as ValidationType, required: true, min: 1 },
        wallet_address: { type: 'wallet' as ValidationType, required: true },
        amount_tola: { type: 'number' as ValidationType, required: true, min: 0.000000001 },
        reason: { 
            type: 'string' as ValidationType, 
            required: false, 
            enum: ['reward', 'bonus', 'airdrop', 'refund', 'incentive', 'other']
        }
    },

    // NFT Mint
    nftMint: {
        name: { 
            type: 'string' as ValidationType, 
            required: true, 
            minLength: 1, 
            maxLength: 32,
            sanitize: (v: string) => v.trim()
        },
        symbol: { 
            type: 'string' as ValidationType, 
            required: false, 
            maxLength: 10, 
            default: 'VORTEX',
            sanitize: (v: string) => v.toUpperCase().trim()
        },
        uri: { type: 'uri' as ValidationType, required: true },
        description: { type: 'string' as ValidationType, required: false, maxLength: 1000 },
        seller_fee_basis_points: { 
            type: 'number' as ValidationType, 
            required: false, 
            min: 0, 
            max: 10000, 
            default: 500 
        },
        recipient: { type: 'wallet' as ValidationType, required: false },
        is_mutable: { type: 'boolean' as ValidationType, required: false, default: true }
    },

    // NFT Transfer
    nftTransfer: {
        mint_address: { type: 'wallet' as ValidationType, required: true },
        recipient_wallet: { type: 'wallet' as ValidationType, required: true }
    },

    // Payment Intent
    paymentIntent: {
        order_id: { type: 'string' as ValidationType, required: true, maxLength: 100 },
        amount_usd: { type: 'number' as ValidationType, required: true, min: 0.01 },
        currency: { 
            type: 'string' as ValidationType, 
            required: false, 
            enum: ['USDC', 'TOLA'], 
            default: 'USDC' 
        },
        buyer_email: { type: 'email' as ValidationType, required: false },
        buyer_wallet: { type: 'wallet' as ValidationType, required: false }
    },

    // Wallet Address param
    walletParam: {
        wallet: { type: 'wallet' as ValidationType, required: true }
    },

    // Mint Address param
    mintParam: {
        mint_address: { type: 'wallet' as ValidationType, required: true }
    },

    // Signature param
    signatureParam: {
        signature: { type: 'signature' as ValidationType, required: true }
    },

    // Pagination
    pagination: {
        limit: { type: 'number' as ValidationType, required: false, min: 1, max: 100, default: 20 },
        offset: { type: 'number' as ValidationType, required: false, min: 0, default: 0 }
    }
};

// Export convenience validators
export const validate = {
    body: validateBody,
    query: validateQuery,
    params: validateParams,
    
    // Pre-built validators
    usdcTransfer: validateBody(schemas.usdcTransfer),
    tolaTransfer: validateBody(schemas.tolaTransfer),
    nftMint: validateBody(schemas.nftMint),
    nftTransfer: validateBody(schemas.nftTransfer),
    paymentIntent: validateBody(schemas.paymentIntent),
    walletParam: validateParams(schemas.walletParam),
    mintParam: validateParams(schemas.mintParam),
    signatureParam: validateParams(schemas.signatureParam),
    pagination: validateQuery(schemas.pagination)
};
