import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    console.error('[ERROR]', err);

    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
}
