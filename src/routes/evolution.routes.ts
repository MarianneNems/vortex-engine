/**
 * VORTEX AI Engine - Evolution System Routes
 * 
 * Backend endpoints for test-time scaling, genetic evolution,
 * open model integration, and real-time thinking.
 * 
 * @package VortexEngine
 * @since 4.1.0
 */

import { Router, Request, Response } from 'express';

const router = Router();

// ===== IN-MEMORY STORES (Production: Use Redis/Database) =====
interface ScalingSession {
    sessionId: string;
    userId: number;
    computeBudget: number;
    strategy: string;
    startedAt: number;
    completedAt?: number;
    qualityScore?: number;
}

interface GeneticPopulation {
    targetId: string;
    generation: number;
    bestFitness: number;
    avgFitness: number;
    populationSize: number;
    lastEvolved: number;
}

interface ModelDiscovery {
    id: string;
    source: string;
    name: string;
    relevanceScore: number;
    discoveredAt: number;
    status: string;
}

interface ThinkingSession {
    sessionId: string;
    userId: number;
    reasoningMode: string;
    thoughtCount: number;
    thinkingTimeMs: number;
    createdAt: number;
}

const scalingSessions: Map<string, ScalingSession> = new Map();
const geneticPopulations: Map<string, GeneticPopulation> = new Map();
const modelDiscoveries: Map<string, ModelDiscovery> = new Map();
const thinkingSessions: Map<string, ThinkingSession> = new Map();
const trainingMetrics: Array<{
    type: string;
    name: string;
    value: number;
    timestamp: number;
}> = [];

// ===== TEST-TIME SCALING ENDPOINTS =====

/**
 * Record scaling session start
 */
router.post('/scaling/start', (req: Request, res: Response) => {
    try {
        const { session_id, user_id, compute_budget, strategy, complexity_score } = req.body;
        
        const session: ScalingSession = {
            sessionId: session_id,
            userId: user_id,
            computeBudget: compute_budget,
            strategy: strategy,
            startedAt: Date.now()
        };
        
        scalingSessions.set(session_id, session);
        
        // Record metric
        trainingMetrics.push({
            type: 'scaling',
            name: 'session_started',
            value: 1,
            timestamp: Date.now()
        });
        
        console.log(`[EVOLUTION] Scaling session started: ${session_id}, Strategy: ${strategy}, Budget: ${compute_budget}`);
        
        res.json({
            success: true,
            session_id,
            message: 'Scaling session started'
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Scaling start error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Record scaling session completion
 */
router.post('/scaling/complete', (req: Request, res: Response) => {
    try {
        const { session_id, quality_score, tokens_used, generation_time } = req.body;
        
        const session = scalingSessions.get(session_id);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        
        session.completedAt = Date.now();
        session.qualityScore = quality_score;
        
        // Calculate effectiveness
        const thinkingTime = session.completedAt - session.startedAt;
        const effectiveness = quality_score * (1 - Math.min(thinkingTime / 10000, 0.5));
        
        // Record metrics
        trainingMetrics.push(
            { type: 'scaling', name: 'quality_score', value: quality_score, timestamp: Date.now() },
            { type: 'scaling', name: 'effectiveness', value: effectiveness, timestamp: Date.now() },
            { type: 'scaling', name: `strategy_${session.strategy}`, value: 1, timestamp: Date.now() }
        );
        
        console.log(`[EVOLUTION] Scaling complete: ${session_id}, Quality: ${quality_score}, Effectiveness: ${effectiveness.toFixed(3)}`);
        
        res.json({
            success: true,
            session_id,
            quality_score,
            effectiveness,
            thinking_time_ms: thinkingTime
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Scaling complete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get scaling status
 */
router.get('/scaling/status', (req: Request, res: Response) => {
    const activeSessions = Array.from(scalingSessions.values())
        .filter(s => !s.completedAt)
        .length;
    
    const completedSessions = Array.from(scalingSessions.values())
        .filter(s => s.completedAt);
    
    const avgQuality = completedSessions.length > 0
        ? completedSessions.reduce((sum, s) => sum + (s.qualityScore || 0), 0) / completedSessions.length
        : 0;
    
    res.json({
        success: true,
        active_sessions: activeSessions,
        completed_sessions: completedSessions.length,
        avg_quality: avgQuality,
        strategies: ['standard', 'beam_search', 'parallel_exploration', 'extended_thinking', 'full_reasoning']
    });
});

// ===== GENETIC EVOLUTION ENDPOINTS =====

/**
 * Record genetic population update
 */
router.post('/genetic/update', (req: Request, res: Response) => {
    try {
        const { target_id, generation, best_fitness, avg_fitness, population_size } = req.body;
        
        const population: GeneticPopulation = {
            targetId: target_id,
            generation,
            bestFitness: best_fitness,
            avgFitness: avg_fitness,
            populationSize: population_size,
            lastEvolved: Date.now()
        };
        
        geneticPopulations.set(target_id, population);
        
        // Record metrics
        trainingMetrics.push(
            { type: 'genetic', name: 'evolution_cycle', value: 1, timestamp: Date.now() },
            { type: 'genetic', name: 'best_fitness', value: best_fitness, timestamp: Date.now() },
            { type: 'genetic', name: 'avg_fitness', value: avg_fitness, timestamp: Date.now() }
        );
        
        console.log(`[EVOLUTION] Genetic update: ${target_id}, Gen ${generation}, Best: ${best_fitness.toFixed(4)}`);
        
        res.json({
            success: true,
            target_id,
            generation,
            best_fitness
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Genetic update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Record fitness evaluation
 */
router.post('/genetic/fitness', (req: Request, res: Response) => {
    try {
        const { target_id, individual_id, fitness, feedback } = req.body;
        
        // Record fitness metric
        trainingMetrics.push({
            type: 'genetic',
            name: 'fitness_evaluation',
            value: fitness,
            timestamp: Date.now()
        });
        
        console.log(`[EVOLUTION] Fitness recorded: ${individual_id}, Fitness: ${fitness}`);
        
        res.json({
            success: true,
            individual_id,
            fitness,
            recorded_at: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Fitness recording error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get genetic evolution status
 */
router.get('/genetic/status', (req: Request, res: Response) => {
    const populations = Array.from(geneticPopulations.values());
    
    const totalGenerations = populations.reduce((sum, p) => sum + p.generation, 0);
    const avgFitness = populations.length > 0
        ? populations.reduce((sum, p) => sum + p.bestFitness, 0) / populations.length
        : 0;
    
    res.json({
        success: true,
        population_count: populations.length,
        total_generations: totalGenerations,
        avg_best_fitness: avgFitness,
        populations: populations.map(p => ({
            target_id: p.targetId,
            generation: p.generation,
            best_fitness: p.bestFitness
        }))
    });
});

// ===== OPEN MODEL HUB ENDPOINTS =====

/**
 * Record model discovery
 */
router.post('/models/discovered', (req: Request, res: Response) => {
    try {
        const { id, source, name, relevance_score, techniques } = req.body;
        
        const discovery: ModelDiscovery = {
            id,
            source,
            name,
            relevanceScore: relevance_score,
            discoveredAt: Date.now(),
            status: 'discovered'
        };
        
        modelDiscoveries.set(id, discovery);
        
        // Record metric
        trainingMetrics.push({
            type: 'discovery',
            name: `source_${source}`,
            value: 1,
            timestamp: Date.now()
        });
        
        console.log(`[EVOLUTION] Model discovered: ${name} from ${source}, Relevance: ${relevance_score}`);
        
        res.json({
            success: true,
            id,
            name,
            source,
            relevance_score
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Model discovery error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Record technique integration
 */
router.post('/models/integrate', (req: Request, res: Response) => {
    try {
        const { technique_name, source_model, confidence, parameters } = req.body;
        
        // Record metric
        trainingMetrics.push({
            type: 'integration',
            name: 'technique_integrated',
            value: confidence,
            timestamp: Date.now()
        });
        
        console.log(`[EVOLUTION] Technique integrated: ${technique_name} from ${source_model}`);
        
        res.json({
            success: true,
            technique: technique_name,
            source_model,
            confidence,
            integrated_at: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Integration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get discovery status
 */
router.get('/models/status', (req: Request, res: Response) => {
    const discoveries = Array.from(modelDiscoveries.values());
    
    const bySource: { [key: string]: number } = {};
    discoveries.forEach(d => {
        bySource[d.source] = (bySource[d.source] || 0) + 1;
    });
    
    res.json({
        success: true,
        total_discovered: discoveries.length,
        by_source: bySource,
        high_relevance: discoveries.filter(d => d.relevanceScore > 0.8).length,
        recent: discoveries
            .sort((a, b) => b.discoveredAt - a.discoveredAt)
            .slice(0, 10)
            .map(d => ({ id: d.id, name: d.name, source: d.source, relevance: d.relevanceScore }))
    });
});

// ===== REAL-TIME THINKING ENDPOINTS =====

/**
 * Record thinking session
 */
router.post('/thinking/record', (req: Request, res: Response) => {
    try {
        const { session_id, user_id, reasoning_mode, thought_count, thinking_time_ms, thoughts } = req.body;
        
        const session: ThinkingSession = {
            sessionId: session_id,
            userId: user_id,
            reasoningMode: reasoning_mode,
            thoughtCount: thought_count,
            thinkingTimeMs: thinking_time_ms,
            createdAt: Date.now()
        };
        
        thinkingSessions.set(session_id, session);
        
        // Record metrics
        trainingMetrics.push(
            { type: 'thinking', name: 'session_count', value: 1, timestamp: Date.now() },
            { type: 'thinking', name: 'thought_count', value: thought_count, timestamp: Date.now() },
            { type: 'thinking', name: `mode_${reasoning_mode}`, value: 1, timestamp: Date.now() }
        );
        
        console.log(`[EVOLUTION] Thinking recorded: ${session_id}, Mode: ${reasoning_mode}, Thoughts: ${thought_count}`);
        
        res.json({
            success: true,
            session_id,
            reasoning_mode,
            thought_count,
            thinking_time_ms
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Thinking record error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get thinking status
 */
router.get('/thinking/status', (req: Request, res: Response) => {
    const sessions = Array.from(thinkingSessions.values());
    
    const modeDistribution: { [key: string]: number } = {};
    let totalThoughts = 0;
    let totalTime = 0;
    
    sessions.forEach(s => {
        modeDistribution[s.reasoningMode] = (modeDistribution[s.reasoningMode] || 0) + 1;
        totalThoughts += s.thoughtCount;
        totalTime += s.thinkingTimeMs;
    });
    
    const avgThoughts = sessions.length > 0 ? totalThoughts / sessions.length : 0;
    const avgTime = sessions.length > 0 ? totalTime / sessions.length : 0;
    
    res.json({
        success: true,
        total_sessions: sessions.length,
        avg_thoughts_per_session: avgThoughts,
        avg_thinking_time_ms: avgTime,
        mode_distribution: modeDistribution
    });
});

// ===== TRAINING OBSERVATORY ENDPOINTS =====

/**
 * Record training metric
 */
router.post('/observatory/metric', (req: Request, res: Response) => {
    try {
        const { type, name, value, metadata } = req.body;
        
        trainingMetrics.push({
            type,
            name,
            value,
            timestamp: Date.now()
        });
        
        // Keep only last 10000 metrics
        if (trainingMetrics.length > 10000) {
            trainingMetrics.splice(0, trainingMetrics.length - 10000);
        }
        
        res.json({
            success: true,
            recorded: true
        });
    } catch (error: any) {
        console.error('[EVOLUTION] Metric recording error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get training levels
 */
router.get('/observatory/levels', (req: Request, res: Response) => {
    // Calculate levels based on stored metrics
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    
    const recentMetrics = trainingMetrics.filter(m => m.timestamp > last24h);
    
    // Calculate HURAII level
    const qualityMetrics = recentMetrics.filter(m => m.name === 'quality_score');
    const avgQuality = qualityMetrics.length > 0
        ? qualityMetrics.reduce((sum, m) => sum + m.value, 0) / qualityMetrics.length
        : 0.5;
    const huraiiScore = avgQuality * 60 + Math.min(qualityMetrics.length / 100, 40);
    
    // Calculate Genetic level
    const fitnessMetrics = recentMetrics.filter(m => m.name === 'best_fitness');
    const avgFitness = fitnessMetrics.length > 0
        ? fitnessMetrics.reduce((sum, m) => sum + m.value, 0) / fitnessMetrics.length
        : 0;
    const geneticScore = avgFitness * 50 + Math.min(geneticPopulations.size * 10, 50);
    
    // Calculate Thinking level
    const thinkingMetrics = recentMetrics.filter(m => m.type === 'thinking');
    const thinkingScore = Math.min(thinkingMetrics.length * 2, 100);
    
    // Calculate Integration level
    const integrationMetrics = recentMetrics.filter(m => m.type === 'integration');
    const integrationScore = Math.min(integrationMetrics.length * 10, 50) + 
        Math.min(modelDiscoveries.size / 10, 50);
    
    const getLevel = (score: number) => {
        if (score >= 95) return 'Absolute';
        if (score >= 85) return 'Cryptonic';
        if (score >= 75) return 'Amazing';
        if (score >= 60) return 'Great';
        if (score >= 40) return 'Good';
        return 'Novice';
    };
    
    res.json({
        success: true,
        levels: {
            huraii: { level: getLevel(huraiiScore), score: huraiiScore },
            genetic: { level: getLevel(geneticScore), score: geneticScore },
            thinking: { level: getLevel(thinkingScore), score: thinkingScore },
            integration: { level: getLevel(integrationScore), score: integrationScore }
        },
        overall: getLevel((huraiiScore + geneticScore + thinkingScore + integrationScore) / 4)
    });
});

/**
 * Get aggregated metrics
 */
router.get('/observatory/metrics', (req: Request, res: Response) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    
    const recentMetrics = trainingMetrics.filter(m => m.timestamp > cutoff);
    
    // Aggregate by type
    const aggregated: { [key: string]: { count: number; sum: number; avg: number } } = {};
    
    recentMetrics.forEach(m => {
        const key = `${m.type}.${m.name}`;
        if (!aggregated[key]) {
            aggregated[key] = { count: 0, sum: 0, avg: 0 };
        }
        aggregated[key].count++;
        aggregated[key].sum += m.value;
        aggregated[key].avg = aggregated[key].sum / aggregated[key].count;
    });
    
    res.json({
        success: true,
        period_hours: hours,
        total_metrics: recentMetrics.length,
        aggregated
    });
});

/**
 * Get comprehensive status
 */
router.get('/status', (req: Request, res: Response) => {
    res.json({
        success: true,
        evolution_systems: {
            test_time_scaling: {
                active_sessions: Array.from(scalingSessions.values()).filter(s => !s.completedAt).length,
                total_sessions: scalingSessions.size
            },
            genetic_evolution: {
                populations: geneticPopulations.size,
                total_generations: Array.from(geneticPopulations.values()).reduce((sum, p) => sum + p.generation, 0)
            },
            open_model_hub: {
                discovered_models: modelDiscoveries.size,
                high_relevance: Array.from(modelDiscoveries.values()).filter(d => d.relevanceScore > 0.8).length
            },
            realtime_thinking: {
                total_sessions: thinkingSessions.size,
                total_thoughts: Array.from(thinkingSessions.values()).reduce((sum, s) => sum + s.thoughtCount, 0)
            }
        },
        metrics_stored: trainingMetrics.length,
        uptime: process.uptime()
    });
});

// ===== WEBHOOK FROM WORDPRESS =====

/**
 * Receive evolution updates from WordPress
 */
router.post('/webhook/wordpress', (req: Request, res: Response) => {
    try {
        const { event_type, data, timestamp } = req.body;
        
        console.log(`[EVOLUTION] WordPress webhook: ${event_type}`);
        
        switch (event_type) {
            case 'scaling_complete':
                trainingMetrics.push({
                    type: 'scaling',
                    name: 'wp_complete',
                    value: data.quality_score || 0,
                    timestamp: Date.now()
                });
                break;
                
            case 'genetic_evolved':
                trainingMetrics.push({
                    type: 'genetic',
                    name: 'wp_evolved',
                    value: data.generation || 0,
                    timestamp: Date.now()
                });
                break;
                
            case 'model_integrated':
                trainingMetrics.push({
                    type: 'integration',
                    name: 'wp_integrated',
                    value: data.confidence || 0,
                    timestamp: Date.now()
                });
                break;
                
            case 'thinking_complete':
                trainingMetrics.push({
                    type: 'thinking',
                    name: 'wp_complete',
                    value: data.thought_count || 0,
                    timestamp: Date.now()
                });
                break;
        }
        
        res.json({
            success: true,
            event_type,
            processed_at: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[EVOLUTION] WordPress webhook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;

