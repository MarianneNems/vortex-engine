/**
 * Centralized Mint Error Handler
 *
 * Maps internal errors to safe, user-friendly JSON responses.
 * Attaches a unique request_id for support traceability.
 * Never exposes stack traces to the client.
 *
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

// -----------------------------------------------------------------------
// request_id helper -- attaches to req and res
// -----------------------------------------------------------------------

declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}

export function attachRequestId(req: Request, _res: Response, next: NextFunction): void {
    req.requestId = crypto.randomUUID();
    next();
}

// -----------------------------------------------------------------------
// Error code map
// -----------------------------------------------------------------------

interface SafeError {
    httpStatus: number;
    code: string;
    message: string;
    retryable: boolean;
}

const ERROR_MAP: Record<string, SafeError> = {
    INSUFFICIENT_TREASURY_SOL: {
        httpStatus: 503,
        code: 'INSUFFICIENT_TREASURY_SOL',
        message: 'Minting is temporarily paused while we replenish network fees. Please try again soon.',
        retryable: true
    },
    RATE_LIMITED: {
        httpStatus: 429,
        code: 'RATE_LIMITED',
        message: 'Too many mint attempts. Please wait and try again later.',
        retryable: true
    },
    NOT_ELIGIBLE: {
        httpStatus: 403,
        code: 'NOT_ELIGIBLE',
        message: 'Minting is currently available to eligible users only.',
        retryable: false
    },
    INVALID_SIGNATURE: {
        httpStatus: 400,
        code: 'INVALID_SIGNATURE',
        message: 'Request signature verification failed.',
        retryable: false
    },
    METADATA_UPLOAD_FAILED: {
        httpStatus: 502,
        code: 'METADATA_UPLOAD_FAILED',
        message: 'Failed to upload NFT metadata. Please try again.',
        retryable: true
    },
    SOLANA_RPC_ERROR: {
        httpStatus: 502,
        code: 'SOLANA_RPC_ERROR',
        message: 'Blockchain network is temporarily unreachable. Please try again.',
        retryable: true
    },
    MINT_FAILED: {
        httpStatus: 500,
        code: 'MINT_FAILED',
        message: 'Minting failed due to a network issue. Please try again shortly.',
        retryable: true
    },
    VALIDATION_ERROR: {
        httpStatus: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data.',
        retryable: false
    }
};

// -----------------------------------------------------------------------
// Classify raw error into a safe code
// -----------------------------------------------------------------------

function classifyError(error: any): string {
    const msg = (error?.message || '').toLowerCase();

    if (msg.includes('insufficient') && msg.includes('sol')) return 'INSUFFICIENT_TREASURY_SOL';
    if (msg.includes('debit an account') || msg.includes('no record of a prior credit')) return 'INSUFFICIENT_TREASURY_SOL';
    if (msg.includes('simulation failed')) return 'MINT_FAILED';
    if (msg.includes('blockhash') || msg.includes('rpc') || msg.includes('connection')) return 'SOLANA_RPC_ERROR';
    if (msg.includes('metadata') || msg.includes('arweave') || msg.includes('upload')) return 'METADATA_UPLOAD_FAILED';
    if (msg.includes('signature') || msg.includes('hmac')) return 'INVALID_SIGNATURE';
    if (msg.includes('rate') || msg.includes('limit')) return 'RATE_LIMITED';

    return 'MINT_FAILED';
}

// -----------------------------------------------------------------------
// Build safe JSON response from any thrown error
// -----------------------------------------------------------------------

export function buildSafeErrorResponse(error: any, requestId: string): {
    httpStatus: number;
    body: Record<string, any>;
} {
    const code = classifyError(error);
    const mapped = ERROR_MAP[code] || ERROR_MAP['MINT_FAILED'];

    return {
        httpStatus: mapped.httpStatus,
        body: {
            ok: false,
            success: false,
            code: mapped.code,
            message: mapped.message,
            retryable: mapped.retryable,
            request_id: requestId
        }
    };
}

// -----------------------------------------------------------------------
// Express error-handling middleware for mint routes
// -----------------------------------------------------------------------

export function mintErrorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
    const requestId = req.requestId || crypto.randomUUID();

    // Log full details server-side
    logger.error('[Mint Error]', {
        request_id: requestId,
        error: err?.message,
        stack: err?.stack,
        method: req.method,
        url: req.originalUrl,
        wallet: req.body?.recipient_wallet || req.body?.wallet_address || 'unknown'
    });

    const { httpStatus, body } = buildSafeErrorResponse(err, requestId);
    res.status(httpStatus).json(body);
}
