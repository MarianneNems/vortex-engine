/**
 * VORTEX AI Scaling Routes v4.0.0
 * 
 * Backend routes for AI scaling orchestration:
 * - Scale UP: Vertical scaling (memory, GPU, compute)
 * - Scale OUT: Horizontal scaling (distributed nodes)
 * - ONE HEARTBEAT: Synchronized rhythm across all components
 * - ULTIMATE MEMORY: Distributed AI memory management
 * 
 * @version 4.0.0
 */

import express, { Request, Response } from 'express';

const router = express.Router();

// Node registry
interface ScalingNode {
    id: string;
    type: 'inference' | 'memory' | 'coordinator';
    status: 'active' | 'provisioning' | 'draining' | 'terminated';
    endpoint?: string;
    createdAt: number;
    lastHeartbeat: number;
    metrics: {
        memoryUsage: number;
        gpuUsage: number;
        activeRequests: number;
    };
    shards: number[];
}

// Heartbeat state
interface HeartbeatState {
    nodeId: string;
    timestamp: number;
    beatCount: number;
    rhythmHash: string;
    drift: number;
}

// Scaling state
interface ScalingState {
    nodes: Map<string, ScalingNode>;
    heartbeats: Map<string, HeartbeatState>;
    masterNode: string | null;
    totalMemoryGB: number;
    totalGPUs: number;
    shardDistribution: Map<number, { primary: string; replicas: string[] }>;
}

const state: ScalingState = {
    nodes: new Map(),
    heartbeats: new Map(),
    masterNode: null,
    totalMemoryGB: 16,
    totalGPUs: 1,
    shardDistribution: new Map()
};

// Configuration
const CONFIG = {
    heartbeatTimeoutMs: 5000,
    maxNodes: 100,
    minNodes: 1,
    shardCount: 16,
    replicationFactor: 3,
    memoryTiers: [16, 32, 64, 128, 256, 512, 1024],
    gpuTiers: ['T4', 'A10G', 'A100_40', 'A100_80', 'H100']
};

/**
 * Generate rhythm hash for synchronization
 */
function generateRhythmHash(nodeId: string, beatCount: number): string {
    const data = `${nodeId}:${beatCount}:${Math.floor(Date.now() / 1000)}`;
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Get master node (coordinator with earliest creation)
 */
function getMasterNode(): ScalingNode | null {
    let master: ScalingNode | null = null;
    
    for (const node of state.nodes.values()) {
        if (node.type === 'coordinator' && node.status === 'active') {
            if (!master || node.createdAt < master.createdAt) {
                master = node;
            }
        }
    }
    
    return master;
}

/**
 * Heartbeat endpoint - nodes report their status
 */
router.post('/heartbeat', async (req: Request, res: Response) => {
    try {
        const { node_id, timestamp, beat_count, rhythm_hash, metrics } = req.body;
        
        if (!node_id) {
            return res.status(400).json({ success: false, error: 'Missing node_id' });
        }
        
        // Update or create node
        let node = state.nodes.get(node_id);
        
        if (!node) {
            node = {
                id: node_id,
                type: 'coordinator',
                status: 'active',
                createdAt: Date.now(),
                lastHeartbeat: Date.now(),
                metrics: metrics || { memoryUsage: 0, gpuUsage: 0, activeRequests: 0 },
                shards: []
            };
            state.nodes.set(node_id, node);
        } else {
            node.lastHeartbeat = Date.now();
            if (metrics) {
                node.metrics = metrics;
            }
        }
        
        // Record heartbeat
        state.heartbeats.set(node_id, {
            nodeId: node_id,
            timestamp: timestamp || Date.now(),
            beatCount: beat_count || 0,
            rhythmHash: rhythm_hash || generateRhythmHash(node_id, beat_count || 0),
            drift: 0
        });
        
        // Check for master
        const master = getMasterNode();
        if (master && !state.masterNode) {
            state.masterNode = master.id;
        }
        
        // Calculate drift from master
        let drift = 0;
        if (state.masterNode && state.masterNode !== node_id) {
            const masterHeartbeat = state.heartbeats.get(state.masterNode);
            if (masterHeartbeat) {
                drift = Math.abs((timestamp || Date.now()) - masterHeartbeat.timestamp);
            }
        }
        
        res.json({
            success: true,
            node_id,
            status: 'synchronized',
            drift_ms: drift,
            master_node: state.masterNode,
            total_nodes: state.nodes.size,
            rhythm_hash: generateRhythmHash(node_id, beat_count || 0)
        });
        
    } catch (error) {
        console.error('[SCALING] Heartbeat error:', error);
        res.status(500).json({ success: false, error: 'Heartbeat processing failed' });
    }
});

/**
 * Get cluster status
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const now = Date.now();
        
        // Check for stale nodes
        for (const [id, node] of state.nodes) {
            if (now - node.lastHeartbeat > CONFIG.heartbeatTimeoutMs) {
                node.status = 'draining';
            }
        }
        
        const activeNodes = Array.from(state.nodes.values()).filter(n => n.status === 'active');
        
        res.json({
            success: true,
            status: {
                total_nodes: state.nodes.size,
                active_nodes: activeNodes.length,
                master_node: state.masterNode,
                total_memory_gb: state.totalMemoryGB,
                total_gpus: state.totalGPUs,
                shard_count: CONFIG.shardCount,
                nodes: Array.from(state.nodes.values()).map(n => ({
                    id: n.id,
                    type: n.type,
                    status: n.status,
                    last_heartbeat: n.lastHeartbeat,
                    metrics: n.metrics
                })),
                heartbeats: Array.from(state.heartbeats.values()).map(h => ({
                    node_id: h.nodeId,
                    beat_count: h.beatCount,
                    drift_ms: h.drift,
                    rhythm_hash: h.rhythmHash
                }))
            },
            timestamp: now
        });
        
    } catch (error) {
        console.error('[SCALING] Status error:', error);
        res.status(500).json({ success: false, error: 'Failed to get status' });
    }
});

/**
 * Resource scaling request
 */
router.post('/resource', async (req: Request, res: Response) => {
    try {
        const { type, target, node_id } = req.body;
        
        console.log(`[SCALING] Resource request: ${type} -> ${target} from ${node_id}`);
        
        let result: any = { success: true };
        
        switch (type) {
            case 'memory':
                // Simulate memory scaling
                const newMemory = parseInt(target) || state.totalMemoryGB * 2;
                state.totalMemoryGB = Math.min(newMemory, 1024);
                result.new_memory_gb = state.totalMemoryGB;
                result.message = `Memory scaled to ${state.totalMemoryGB}GB`;
                break;
                
            case 'gpu':
                // Simulate GPU upgrade
                const gpuIndex = CONFIG.gpuTiers.indexOf(target);
                if (gpuIndex >= 0) {
                    result.new_gpu = target;
                    result.message = `GPU upgraded to ${target}`;
                } else {
                    result.success = false;
                    result.error = 'Invalid GPU tier';
                }
                break;
                
            case 'compute':
                // Simulate compute scaling
                result.compute_multiplier = target || 1.5;
                result.message = `Compute scaled by ${target || 1.5}x`;
                break;
                
            default:
                result.success = false;
                result.error = 'Unknown resource type';
        }
        
        res.json(result);
        
    } catch (error) {
        console.error('[SCALING] Resource error:', error);
        res.status(500).json({ success: false, error: 'Resource scaling failed' });
    }
});

/**
 * Provision new node
 */
router.post('/provision', async (req: Request, res: Response) => {
    try {
        const { id, type } = req.body;
        
        if (state.nodes.size >= CONFIG.maxNodes) {
            return res.status(400).json({
                success: false,
                error: 'Maximum node count reached'
            });
        }
        
        const nodeId = id || `node_${Date.now()}`;
        const nodeType = type || 'inference';
        
        const node: ScalingNode = {
            id: nodeId,
            type: nodeType,
            status: 'provisioning',
            createdAt: Date.now(),
            lastHeartbeat: Date.now(),
            metrics: { memoryUsage: 0, gpuUsage: 0, activeRequests: 0 },
            shards: []
        };
        
        // Simulate provisioning delay
        setTimeout(() => {
            node.status = 'active';
            
            // Assign shards if memory node
            if (nodeType === 'memory' || nodeType === 'inference') {
                redistributeShards();
            }
        }, 2000);
        
        state.nodes.set(nodeId, node);
        
        console.log(`[SCALING] Provisioned node: ${nodeId} (${nodeType})`);
        
        res.json({
            success: true,
            node_id: nodeId,
            type: nodeType,
            status: 'provisioning',
            endpoint: `http://localhost:3000/nodes/${nodeId}`
        });
        
    } catch (error) {
        console.error('[SCALING] Provision error:', error);
        res.status(500).json({ success: false, error: 'Node provisioning failed' });
    }
});

/**
 * Deprovision node
 */
router.post('/deprovision', async (req: Request, res: Response) => {
    try {
        const { node_id } = req.body;
        
        const node = state.nodes.get(node_id);
        
        if (!node) {
            return res.status(404).json({
                success: false,
                error: 'Node not found'
            });
        }
        
        if (state.nodes.size <= CONFIG.minNodes) {
            return res.status(400).json({
                success: false,
                error: 'Cannot reduce below minimum node count'
            });
        }
        
        // Mark as draining
        node.status = 'draining';
        
        // Migrate shards
        migrateNodeShards(node_id);
        
        // Remove after delay
        setTimeout(() => {
            state.nodes.delete(node_id);
            state.heartbeats.delete(node_id);
            redistributeShards();
        }, 5000);
        
        console.log(`[SCALING] Deprovisioning node: ${node_id}`);
        
        res.json({
            success: true,
            node_id,
            status: 'draining',
            message: 'Node will be removed after data migration'
        });
        
    } catch (error) {
        console.error('[SCALING] Deprovision error:', error);
        res.status(500).json({ success: false, error: 'Node deprovisioning failed' });
    }
});

/**
 * Redistribute shards across nodes
 */
function redistributeShards(): void {
    const memoryNodes = Array.from(state.nodes.values())
        .filter(n => (n.type === 'memory' || n.type === 'inference') && n.status === 'active');
    
    if (memoryNodes.length === 0) return;
    
    state.shardDistribution.clear();
    
    for (let shard = 0; shard < CONFIG.shardCount; shard++) {
        const primaryIndex = shard % memoryNodes.length;
        const primary = memoryNodes[primaryIndex];
        
        const replicas: string[] = [];
        for (let r = 1; r < CONFIG.replicationFactor && r < memoryNodes.length; r++) {
            const replicaIndex = (primaryIndex + r) % memoryNodes.length;
            replicas.push(memoryNodes[replicaIndex].id);
        }
        
        state.shardDistribution.set(shard, {
            primary: primary.id,
            replicas
        });
        
        // Update node shard assignments
        if (!primary.shards.includes(shard)) {
            primary.shards.push(shard);
        }
    }
    
    console.log(`[SCALING] Redistributed ${CONFIG.shardCount} shards across ${memoryNodes.length} nodes`);
}

/**
 * Migrate shards from a node being removed
 */
function migrateNodeShards(nodeId: string): void {
    for (const [shard, assignment] of state.shardDistribution) {
        if (assignment.primary === nodeId && assignment.replicas.length > 0) {
            // Promote first replica to primary
            assignment.primary = assignment.replicas[0];
            assignment.replicas = assignment.replicas.slice(1);
            
            console.log(`[SCALING] Migrated shard ${shard} from ${nodeId} to ${assignment.primary}`);
        }
    }
}

/**
 * Shard redistribution notification
 */
router.post('/shard_redistribution', async (req: Request, res: Response) => {
    try {
        redistributeShards();
        
        res.json({
            success: true,
            shard_count: CONFIG.shardCount,
            distribution: Object.fromEntries(state.shardDistribution)
        });
        
    } catch (error) {
        console.error('[SCALING] Shard redistribution error:', error);
        res.status(500).json({ success: false, error: 'Shard redistribution failed' });
    }
});

/**
 * Get shard location for a key
 */
router.get('/shard/:key', async (req: Request, res: Response) => {
    try {
        const key = req.params.key;
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(key).digest();
        const shardId = hash.readUInt32BE(0) % CONFIG.shardCount;
        
        const assignment = state.shardDistribution.get(shardId);
        
        res.json({
            success: true,
            key,
            shard_id: shardId,
            primary: assignment?.primary || null,
            replicas: assignment?.replicas || []
        });
        
    } catch (error) {
        console.error('[SCALING] Shard lookup error:', error);
        res.status(500).json({ success: false, error: 'Shard lookup failed' });
    }
});

/**
 * Scaling event (from WordPress)
 */
router.post('/event', async (req: Request, res: Response) => {
    try {
        const { event, data, node_id } = req.body;
        
        console.log(`[SCALING] Event from ${node_id}: ${event}`, data);
        
        switch (event) {
            case 'heartbeat':
                // Already handled by /heartbeat endpoint
                break;
                
            case 'sync_node':
                // Sync new node with cluster state
                if (data.node_id) {
                    const node = state.nodes.get(data.node_id);
                    if (node) {
                        node.status = 'active';
                    }
                }
                break;
                
            case 'migrate_shard':
                // Handle shard migration
                migrateNodeShards(data.from_node);
                break;
                
            default:
                console.log(`[SCALING] Unknown event: ${event}`);
        }
        
        res.json({ success: true, event, processed: true });
        
    } catch (error) {
        console.error('[SCALING] Event error:', error);
        res.status(500).json({ success: false, error: 'Event processing failed' });
    }
});

/**
 * GPU usage endpoint
 */
router.get('/gpu/usage', async (req: Request, res: Response) => {
    try {
        // Aggregate GPU usage from all inference nodes
        let totalUsage = 0;
        let nodeCount = 0;
        
        for (const node of state.nodes.values()) {
            if (node.type === 'inference' && node.status === 'active') {
                totalUsage += node.metrics.gpuUsage;
                nodeCount++;
            }
        }
        
        const avgUsage = nodeCount > 0 ? totalUsage / nodeCount : 0;
        
        res.json({
            success: true,
            usage: avgUsage,
            node_count: nodeCount,
            total_gpus: state.totalGPUs
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get GPU usage' });
    }
});

/**
 * Health check
 */
router.get('/health', (req: Request, res: Response) => {
    const activeNodes = Array.from(state.nodes.values()).filter(n => n.status === 'active');
    
    res.json({
        status: activeNodes.length > 0 ? 'healthy' : 'degraded',
        version: '4.0.0',
        nodes: {
            total: state.nodes.size,
            active: activeNodes.length
        },
        master: state.masterNode,
        timestamp: Date.now()
    });
});

export default router;

