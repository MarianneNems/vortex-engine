import { Request, Response, NextFunction } from 'express';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.API_SECRET_KEY;

    if (!validKey || apiKey !== validKey) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized - Invalid API key'
        });
    }

    next();
};
