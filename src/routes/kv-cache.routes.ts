/**
 * VORTEX KV Cache Routes v4.0.0
 * 
 * High-performance Key-Value cache for AI model inference:
 * - Store/retrieve KV cache for transformer attention layers
 * - Single-token generation without full recomputation
 * - Memory management with scaling notifications
 * 
 * @version 4.0.0
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import zlib from 'zlib';

const router = express.Router();

// In-memory KV cache (Redis would be used in production)
interface KVCacheEntry {
    sessionId: string;
    userId: number;
    kvData: string; // Compressed
    tokenPosition: number;
    sequenceLength: number;
    modelId: string;
    createdAt: number;
    lastAccessed: number;
    checksum: string;
    sizeBytes: number;
}

// Cache storage
const kvCache: Map<string, KVCacheEntry> = new Map();
const hotCache: Map<string, KVCacheEntry> = new Map();
const HOT_CACHE_MAX = 1000;

// Memory tracking
interface MemoryStats {
    totalUsed: number;
    maxMemory: number;
    userAllocations: Map<number, { total: number; entries: Map<string, number> }>;
    cacheHits: number;
    cacheMisses: number;
    evictions: number;
}

const memoryStats: MemoryStats = {
    totalUsed: 0,
    maxMemory: 16 * 1024 * 1024 * 1024, // 16GB
    userAllocations: new Map(),
    cacheHits: 0,
    cacheMisses: 0,
    evictions: 0
};

// Configuration
const CONFIG = {
    maxMemoryPerUser: 512 * 1024 * 1024, // 512MB
    maxTotalMemory: 16 * 1024 * 1024 * 1024, // 16GB
    warningThreshold: 0.80,
    criticalThreshold: 0.95,
    sessionTTL: 3600, // 1 hour
    compressionLevel: 6,
    quantizationBits: 8
};

// Notifications queue
const notifications: Array<{
    level: 'info' | 'warning' | 'critical' | 'scaling';
    message: string;
    timestamp: number;
    data?: any;
}> = [];

/**
 * Build cache key
 */
function buildCacheKey(sessionId: string, userId: number): string {
    return `vortex_kv_${userId}_${sessionId}`;
}

/**
 * Compress data
 */
function compressData(data: any): string {
    const json = JSON.stringify(data);
    const compressed = zlib.gzipSync(json, { level: CONFIG.compressionLevel });
    return compressed.toString('base64');
}

/**
 * Decompress data
 */
function decompressData(compressed: string): any {
    const buffer = Buffer.from(compressed, 'base64');
    const decompressed = zlib.gunzipSync(buffer);
    return JSON.parse(decompressed.toString());
}

/**
 * Calculate checksum
 */
function calculateChecksum(data: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

/**
 * Check if memory can be allocated
 */
function canAllocateMemory(userId: number, size: number): boolean {
    const userAllocation = memoryStats.userAllocations.get(userId);
    const userUsed = userAllocation?.total || 0;
    
    if (userUsed + size > CONFIG.maxMemoryPerUser) {
        return false;
    }
    
    if (memoryStats.totalUsed + size > CONFIG.maxTotalMemory) {
        return false;
    }
    
    return true;
}

/**
 * Track memory allocation
 */
function trackMemoryAllocation(userId: number, size: number, cacheKey: string): void {
    let userAllocation = memoryStats.userAllocations.get(userId);
    
    if (!userAllocation) {
        userAllocation = { total: 0, entries: new Map() };
        memoryStats.userAllocations.set(userId, userAllocation);
    }
    
    userAllocation.total += size;
    userAllocation.entries.set(cacheKey, size);
    memoryStats.totalUsed += size;
}

/**
 * Evict LRU entries
 */
function evictLRU(userId: number, neededSize: number): boolean {
    const entries = Array.from(kvCache.entries())
        .filter(([_, v]) => v.userId === userId)
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    
    let freed = 0;
    for (const [key, entry] of entries) {
        if (freed >= neededSize) break;
        
        freed += entry.sizeBytes;
        kvCache.delete(key);
        hotCache.delete(key);
        
        const userAllocation = memoryStats.userAllocations.get(userId);
        if (userAllocation) {
            userAllocation.total -= entry.sizeBytes;
            userAllocation.entries.delete(key);
        }
        memoryStats.totalUsed -= entry.sizeBytes;
        memoryStats.evictions++;
    }
    
    return freed >= neededSize;
}

/**
 * Add notification
 */
function addNotification(level: 'info' | 'warning' | 'critical' | 'scaling', message: string, data?: any): void {
    notifications.push({
        level,
        message,
        timestamp: Date.now(),
        data
    });
    
    // Keep last 100
    if (notifications.length > 100) {
        notifications.shift();
    }
    
    console.log(`[KV CACHE ${level.toUpperCase()}] ${message}`);
}

/**
 * Check memory and notify if needed
 */
function checkMemoryAndNotify(): void {
    const usageRatio = memoryStats.totalUsed / CONFIG.maxTotalMemory;
    
    if (usageRatio >= CONFIG.criticalThreshold) {
        addNotification('critical', `Memory critical: ${(usageRatio * 100).toFixed(1)}% used`, {
            totalUsedGB: (memoryStats.totalUsed / (1024 * 1024 * 1024)).toFixed(2),
            maxMemoryGB: (CONFIG.maxTotalMemory / (1024 * 1024 * 1024)).toFixed(2)
        });
    } else if (usageRatio >= CONFIG.warningThreshold) {
        addNotification('warning', `Memory warning: ${(usageRatio * 100).toFixed(1)}% used`);
    }
}

/**
 * Calculate scaling recommendation
 */
function calculateScalingRecommendation() {
    const usageRatio = memoryStats.totalUsed / CONFIG.maxTotalMemory;
    const activeUsers = memoryStats.userAllocations.size;
    
    return {
        needsScaling: usageRatio > 0.75,
        currentUsageGB: (memoryStats.totalUsed / (1024 * 1024 * 1024)).toFixed(2),
        maxMemoryGB: (CONFIG.maxTotalMemory / (1024 * 1024 * 1024)).toFixed(2),
        usagePercentage: (usageRatio * 100).toFixed(1),
        activeUsers,
        cacheHitRatio: memoryStats.cacheHits + memoryStats.cacheMisses > 0
            ? ((memoryStats.cacheHits / (memoryStats.cacheHits + memoryStats.cacheMisses)) * 100).toFixed(1)
            : '100',
        totalEvictions: memoryStats.evictions,
        recommendedCapacityGB: ((memoryStats.totalUsed * 1.5) / (1024 * 1024 * 1024)).toFixed(2)
    };
}

/**
 * Store KV cache
 */
router.post('/store', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
        const { session_id, user_id, kv_data, metadata = {} } = req.body;
        
        if (!session_id || !user_id || !kv_data) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: session_id, user_id, kv_data'
            });
        }
        
        const cacheKey = buildCacheKey(session_id, user_id);
        
        // Compress data
        const compressed = compressData(kv_data);
        const checksum = calculateChecksum(kv_data);
        const sizeBytes = Buffer.byteLength(compressed, 'base64');
        
        // Check memory limits
        if (!canAllocateMemory(user_id, sizeBytes)) {
            addNotification('warning', `Memory limit for user ${user_id}, evicting LRU entries`);
            evictLRU(user_id, sizeBytes);
        }
        
        // Create entry
        const entry: KVCacheEntry = {
            sessionId: session_id,
            userId: user_id,
            kvData: compressed,
            tokenPosition: metadata.token_position || 0,
            sequenceLength: metadata.sequence_length || 0,
            modelId: metadata.model_id || 'huraii_v4',
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            checksum,
            sizeBytes
        };
        
        // Store in caches
        kvCache.set(cacheKey, entry);
        
        // Hot cache with LRU
        if (hotCache.size >= HOT_CACHE_MAX) {
            const oldest = hotCache.keys().next().value;
            hotCache.delete(oldest);
        }
        hotCache.set(cacheKey, entry);
        
        // Track memory
        trackMemoryAllocation(user_id, sizeBytes, cacheKey);
        
        // Check memory and notify
        checkMemoryAndNotify();
        
        const elapsed = Date.now() - startTime;
        
        res.json({
            success: true,
            session_id,
            cache_key: cacheKey,
            size_bytes: sizeBytes,
            elapsed_ms: elapsed,
            memory_usage: {
                user_mb: ((memoryStats.userAllocations.get(user_id)?.total || 0) / (1024 * 1024)).toFixed(2),
                total_mb: (memoryStats.totalUsed / (1024 * 1024)).toFixed(2)
            }
        });
        
    } catch (error) {
        console.error('[KV CACHE] Store error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to store KV cache',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get KV cache - FAST path for token generation
 */
router.post('/get', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
        const { session_id, user_id } = req.body;
        
        if (!session_id || !user_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: session_id, user_id'
            });
        }
        
        const cacheKey = buildCacheKey(session_id, user_id);
        
        // Try hot cache first (fastest)
        let entry = hotCache.get(cacheKey);
        
        if (entry) {
            memoryStats.cacheHits++;
        } else {
            // Try main cache
            entry = kvCache.get(cacheKey);
            
            if (entry) {
                // Promote to hot cache
                if (hotCache.size >= HOT_CACHE_MAX) {
                    const oldest = hotCache.keys().next().value;
                    hotCache.delete(oldest);
                }
                hotCache.set(cacheKey, entry);
                memoryStats.cacheMisses++;
            }
        }
        
        if (!entry) {
            return res.status(404).json({
                success: false,
                error: 'Cache not found',
                cache_key: cacheKey
            });
        }
        
        // Verify checksum
        const kvData = decompressData(entry.kvData);
        const checksum = calculateChecksum(kvData);
        
        if (checksum !== entry.checksum) {
            kvCache.delete(cacheKey);
            hotCache.delete(cacheKey);
            return res.status(400).json({
                success: false,
                error: 'Cache checksum mismatch, entry invalidated'
            });
        }
        
        // Update access time
        entry.lastAccessed = Date.now();
        
        const elapsed = Date.now() - startTime;
        
        res.json({
            success: true,
            kv_data: kvData,
            token_position: entry.tokenPosition,
            sequence_length: entry.sequenceLength,
            model_id: entry.modelId,
            cache_age_ms: Date.now() - entry.createdAt,
            elapsed_ms: elapsed
        });
        
    } catch (error) {
        console.error('[KV CACHE] Get error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get KV cache',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Append token to existing KV cache
 */
router.post('/append', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
        const { session_id, user_id, new_kv, new_position } = req.body;
        
        if (!session_id || !user_id || !new_kv) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        const cacheKey = buildCacheKey(session_id, user_id);
        let entry = kvCache.get(cacheKey);
        
        if (!entry) {
            // Create new cache with single token
            const compressed = compressData(new_kv);
            const sizeBytes = Buffer.byteLength(compressed, 'base64');
            
            entry = {
                sessionId: session_id,
                userId: user_id,
                kvData: compressed,
                tokenPosition: new_position || 0,
                sequenceLength: 1,
                modelId: 'huraii_v4',
                createdAt: Date.now(),
                lastAccessed: Date.now(),
                checksum: calculateChecksum(new_kv),
                sizeBytes
            };
            
            kvCache.set(cacheKey, entry);
            hotCache.set(cacheKey, entry);
            trackMemoryAllocation(user_id, sizeBytes, cacheKey);
            
            return res.json({
                success: true,
                action: 'created',
                sequence_length: 1,
                elapsed_ms: Date.now() - startTime
            });
        }
        
        // Merge with existing
        const existingKV = decompressData(entry.kvData);
        
        // Merge KV data (append new token's KV)
        const mergedKV: any = {};
        for (const layer of Object.keys(existingKV)) {
            if (new_kv[layer]) {
                mergedKV[layer] = Array.isArray(existingKV[layer])
                    ? [...existingKV[layer], ...new_kv[layer]]
                    : new_kv[layer];
            } else {
                mergedKV[layer] = existingKV[layer];
            }
        }
        
        // Add any new layers
        for (const layer of Object.keys(new_kv)) {
            if (!mergedKV[layer]) {
                mergedKV[layer] = new_kv[layer];
            }
        }
        
        // Update entry
        const oldSize = entry.sizeBytes;
        entry.kvData = compressData(mergedKV);
        entry.sizeBytes = Buffer.byteLength(entry.kvData, 'base64');
        entry.tokenPosition = new_position;
        entry.sequenceLength++;
        entry.lastAccessed = Date.now();
        entry.checksum = calculateChecksum(mergedKV);
        
        // Update memory tracking
        const sizeDiff = entry.sizeBytes - oldSize;
        if (sizeDiff > 0) {
            trackMemoryAllocation(user_id, sizeDiff, cacheKey);
        }
        
        kvCache.set(cacheKey, entry);
        hotCache.set(cacheKey, entry);
        
        res.json({
            success: true,
            action: 'appended',
            sequence_length: entry.sequenceLength,
            token_position: entry.tokenPosition,
            elapsed_ms: Date.now() - startTime
        });
        
    } catch (error) {
        console.error('[KV CACHE] Append error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to append KV cache'
        });
    }
});

/**
 * Invalidate cache
 */
router.post('/invalidate', async (req: Request, res: Response) => {
    try {
        const { session_id, user_id } = req.body;
        
        const cacheKey = buildCacheKey(session_id, user_id);
        const entry = kvCache.get(cacheKey);
        
        if (entry) {
            // Update memory tracking
            const userAllocation = memoryStats.userAllocations.get(user_id);
            if (userAllocation) {
                userAllocation.total -= entry.sizeBytes;
                userAllocation.entries.delete(cacheKey);
            }
            memoryStats.totalUsed -= entry.sizeBytes;
            
            kvCache.delete(cacheKey);
            hotCache.delete(cacheKey);
            
            res.json({ success: true, message: 'Cache invalidated' });
        } else {
            res.json({ success: true, message: 'Cache not found' });
        }
        
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to invalidate cache' });
    }
});

/**
 * Get memory stats
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const hitRatio = memoryStats.cacheHits + memoryStats.cacheMisses > 0
            ? (memoryStats.cacheHits / (memoryStats.cacheHits + memoryStats.cacheMisses)) * 100
            : 100;
        
        res.json({
            success: true,
            stats: {
                total_used_mb: (memoryStats.totalUsed / (1024 * 1024)).toFixed(2),
                max_memory_mb: (CONFIG.maxTotalMemory / (1024 * 1024)).toFixed(2),
                usage_percentage: ((memoryStats.totalUsed / CONFIG.maxTotalMemory) * 100).toFixed(1),
                active_users: memoryStats.userAllocations.size,
                active_sessions: kvCache.size,
                hot_cache_size: hotCache.size,
                cache_hits: memoryStats.cacheHits,
                cache_misses: memoryStats.cacheMisses,
                hit_ratio: hitRatio.toFixed(1),
                evictions: memoryStats.evictions
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get stats' });
    }
});

/**
 * Get scaling recommendation
 */
router.get('/scaling', async (req: Request, res: Response) => {
    try {
        res.json({
            success: true,
            scaling: calculateScalingRecommendation()
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get scaling' });
    }
});

/**
 * Get notifications for admin
 */
router.get('/notifications', async (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.VORTEX_API_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    res.json({
        success: true,
        notifications: notifications.slice(-50),
        scaling: calculateScalingRecommendation()
    });
});

/**
 * Clear all caches (admin only)
 */
router.post('/clear', async (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.VORTEX_API_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    kvCache.clear();
    hotCache.clear();
    memoryStats.totalUsed = 0;
    memoryStats.userAllocations.clear();
    memoryStats.cacheHits = 0;
    memoryStats.cacheMisses = 0;
    memoryStats.evictions = 0;
    
    addNotification('info', 'All caches cleared by admin');
    
    res.json({ success: true, message: 'All caches cleared' });
});

/**
 * Health check
 */
router.get('/health', (req: Request, res: Response) => {
    const usageRatio = memoryStats.totalUsed / CONFIG.maxTotalMemory;
    
    res.json({
        status: usageRatio < CONFIG.criticalThreshold ? 'healthy' : 'degraded',
        version: '4.0.0',
        memory_usage_percent: (usageRatio * 100).toFixed(1),
        active_sessions: kvCache.size,
        timestamp: Date.now()
    });
});

/**
 * GET /api/kv-cache/status
 * Status endpoint (alias for health/stats combined)
 * @version 4.0.0
 */
router.get('/status', (req: Request, res: Response) => {
    const usageRatio = memoryStats.totalUsed / CONFIG.maxTotalMemory;
    const hitRatio = memoryStats.cacheHits + memoryStats.cacheMisses > 0
        ? (memoryStats.cacheHits / (memoryStats.cacheHits + memoryStats.cacheMisses)) * 100
        : 100;
    
    res.json({
        success: true,
        status: usageRatio < CONFIG.criticalThreshold ? 'healthy' : 'degraded',
        version: '4.0.0',
        data: {
            memory: {
                used_mb: (memoryStats.totalUsed / (1024 * 1024)).toFixed(2),
                max_mb: (CONFIG.maxTotalMemory / (1024 * 1024)).toFixed(2),
                usage_percent: (usageRatio * 100).toFixed(1)
            },
            cache: {
                active_sessions: kvCache.size,
                hot_cache_size: hotCache.size,
                hits: memoryStats.cacheHits,
                misses: memoryStats.cacheMisses,
                hit_ratio: hitRatio.toFixed(1),
                evictions: memoryStats.evictions
            },
            users: {
                active: memoryStats.userAllocations.size
            }
        },
        timestamp: new Date().toISOString()
    });
});

export default router;

