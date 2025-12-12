import { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, number[]>();
const RATE_LIMIT = 100;
const TIME_WINDOW = 15 * 60 * 1000; // 15 minutes

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
    }
    
    const requests = requestCounts.get(ip)!.filter(time => now - time < TIME_WINDOW);
    
    if (requests.length >= RATE_LIMIT) {
        return res.status(429).json({
            success: false,
            error: 'Too many requests'
        });
    }
    
    requests.push(now);
    requestCounts.set(ip, requests);
    next();
}
