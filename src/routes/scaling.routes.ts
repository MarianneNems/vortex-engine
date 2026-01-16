/**
 * Scaling Routes
 * Auto-scaling and resource management
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Track scaling metrics
const scalingMetrics = {
    currentInstances: 1,
    maxInstances: 10,
    minInstances: 1,
    avgCpuUsage: 0,
    avgMemoryUsage: 0,
    requestsPerSecond: 0,
    lastScaleUp: null as Date | null,
    lastScaleDown: null as Date | null
};

/**
 * GET /api/scaling/status
 * Get current scaling status
 */
router.get('/status', async (req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            instances: {
                current: scalingMetrics.currentInstances,
                min: scalingMetrics.minInstances,
                max: scalingMetrics.maxInstances
            },
            metrics: {
                cpu_usage: scalingMetrics.avgCpuUsage,
                memory_usage: scalingMetrics.avgMemoryUsage,
                requests_per_second: scalingMetrics.requestsPerSecond
            },
            events: {
                last_scale_up: scalingMetrics.lastScaleUp,
                last_scale_down: scalingMetrics.lastScaleDown
            },
            auto_scaling: {
                enabled: true,
                cpu_threshold: 80,
                memory_threshold: 85,
                cooldown_period: 300
            }
        },
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/scaling/metrics
 * Get detailed scaling metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
    try {
        const memUsage = process.memoryUsage();
        
        res.json({
            success: true,
            data: {
                process: {
                    heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
                    rss_mb: Math.round(memUsage.rss / 1024 / 1024),
                    external_mb: Math.round(memUsage.external / 1024 / 1024)
                },
                uptime_seconds: Math.floor(process.uptime()),
                pid: process.pid,
                node_version: process.version
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
        
    } catch (error: any) {
        logger.error('[SCALING] Metrics error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/scaling/scale
 * Manually trigger scaling (admin only)
 */
router.post('/scale', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { action, target_instances } = req.body;
        
        if (!action || !['up', 'down', 'set'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid action. Use: up, down, or set'
            });
        }
        
        logger.info(`[SCALING] Manual scale ${action}: ${target_instances || 1}`);
        
        res.json({
            success: true,
            data: {
                action,
                previous_instances: scalingMetrics.currentInstances,
                target_instances: target_instances || scalingMetrics.currentInstances + (action === 'up' ? 1 : -1),
                status: 'initiated',
                requested_at: new Date().toISOString()
            },
            version: '4.0.0'
        });
        
    } catch (error: any) {
        logger.error('[SCALING] Scale error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/scaling/recommendations
 * Get scaling recommendations
 */
router.get('/recommendations', async (req: Request, res: Response) => {
    const cpuHigh = scalingMetrics.avgCpuUsage > 80;
    const memHigh = scalingMetrics.avgMemoryUsage > 85;
    const lowTraffic = scalingMetrics.requestsPerSecond < 10;
    
    res.json({
        success: true,
        data: {
            should_scale_up: cpuHigh || memHigh,
            should_scale_down: lowTraffic && scalingMetrics.currentInstances > 1,
            reasons: [
                ...(cpuHigh ? ['High CPU usage'] : []),
                ...(memHigh ? ['High memory usage'] : []),
                ...(lowTraffic ? ['Low traffic'] : [])
            ],
            recommended_instances: cpuHigh || memHigh 
                ? Math.min(scalingMetrics.currentInstances + 1, scalingMetrics.maxInstances)
                : lowTraffic 
                    ? Math.max(scalingMetrics.currentInstances - 1, scalingMetrics.minInstances)
                    : scalingMetrics.currentInstances
        },
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/scaling/health
 * Scaling health check
 */
router.get('/health', async (req: Request, res: Response) => {
    res.json({
        success: true,
        status: 'healthy',
        instances: scalingMetrics.currentInstances,
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

export default router;
