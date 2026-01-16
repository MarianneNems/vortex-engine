/**
 * Error Handling Middleware
 * Global error handler for Express application
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Custom error class
export class AppError extends Error {
    statusCode: number;
    status: string;
    isOperational: boolean;

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
    const error = new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404);
    next(error);
};

/**
 * Global error handler
 */
export const errorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    // Default values
    let statusCode = 500;
    let status = 'error';
    let message = 'Internal server error';
    let stack: string | undefined;

    // Handle AppError
    if (err instanceof AppError) {
        statusCode = err.statusCode;
        status = err.status;
        message = err.message;
    } else if (err instanceof Error) {
        message = err.message;
    }

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
        stack = err.stack;
    }

    // Log error
    logger.error(`[Error ${statusCode}] ${message}`, {
        method: req.method,
        url: req.originalUrl,
        stack: err.stack
    });

    // Send response
    res.status(statusCode).json({
        success: false,
        status,
        message,
        ...(stack && { stack }),
        timestamp: new Date().toISOString()
    });
};

/**
 * Async handler wrapper
 * Catches async errors and passes them to error handler
 */
export const asyncHandler = (fn: Function) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * Validation error handler
 */
export const validationErrorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    if (err.name === 'ValidationError') {
        res.status(400).json({
            success: false,
            status: 'fail',
            message: 'Validation error',
            errors: err.errors,
            timestamp: new Date().toISOString()
        });
        return;
    }
    next(err);
};

/**
 * Rate limit error handler
 */
export const rateLimitHandler = (req: Request, res: Response): void => {
    res.status(429).json({
        success: false,
        status: 'fail',
        message: 'Too many requests. Please try again later.',
        timestamp: new Date().toISOString()
    });
};
