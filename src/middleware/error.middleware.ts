import { Request, Response, NextFunction } from 'express';

interface IAppError extends Error {
    status?: number;
    statusCode?: number;
    isOperational?: boolean;
}

export function errorHandler(err: IAppError, req: Request, res: Response, next: NextFunction) {
    // Log error details
    console.error('[ERROR]', {
        message: err.message,
        stack: err.stack,
        status: err.status || err.statusCode,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });

    // Determine status code
    const statusCode = err.status || err.statusCode || 500;
    
    // Prepare error response
    const errorResponse: any = {
        success: false,
        error: err.message || 'Internal server error',
        statusCode
    };

    // Include stack trace only in development
    if (process.env.NODE_ENV === 'development' && err.stack) {
        errorResponse.stack = err.stack;
    }

    // Send error response
    res.status(statusCode).json(errorResponse);
}

// Custom error class for operational errors
export class AppError extends Error {
    status: number;
    isOperational: boolean;

    constructor(message: string, status: number = 500) {
        super(message);
        this.status = status;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}
