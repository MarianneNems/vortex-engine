/**
 * VORTEX Agentic AI Routes v4.0.0
 * 
 * Node.js/Express backend routes for the Agentic AI system
 * Handles intelligent routing, NVIDIA integration, and pipeline orchestration
 * 
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';

const router = Router();

// ============================================
// AGENTIC ROUTER ENDPOINTS
// ============================================

/**
 * POST /api/agentic/route
 * Route a request to the optimal AI agent
 */
router.post('/route', async (req: Request, res: Response) => {
    try {
        const { prompt, context, user_id, budget_mode } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt required' });
        }
        
        // Intent classification
        const intent = classifyIntent(prompt, context);
        
        // Agent scoring
        const agentScores = scoreAgents(intent, prompt, context);
        
        // Select optimal agent
        const selectedAgent = selectOptimalAgent(agentScores, budget_mode);
        
        console.log(`[AGENTIC] Routed to ${selectedAgent.id} (intent: ${intent.type}, confidence: ${intent.confidence.toFixed(2)})`);
        
        res.json({
            success: true,
            routing: {
                selected_agent: selectedAgent.id,
                agent_provider: selectedAgent.provider,
                intent_type: intent.type,
                confidence: intent.confidence,
                quality_score: selectedAgent.quality_score,
                timestamp: new Date().toISOString()
            },
            agent_scores: Object.fromEntries(
                Object.entries(agentScores).slice(0, 5)
            )
        });
        
    } catch (error: any) {
        console.error('[AGENTIC] Routing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/agentic/classify
 * Classify intent from prompt
 */
router.post('/classify', async (req: Request, res: Response) => {
    try {
        const { prompt, context } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt required' });
        }
        
        const intent = classifyIntent(prompt, context || {});
        
        res.json({
            success: true,
            intent
        });
        
    } catch (error: any) {
        console.error('[AGENTIC] Classification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/agentic/agents
 * Get all available agents
 */
router.get('/agents', async (req: Request, res: Response) => {
    try {
        const agents = getAvailableAgents();
        
        res.json({
            success: true,
            agents,
            count: Object.keys(agents).length,
            version: '4.0.0'
        });
        
    } catch (error: any) {
        console.error('[AGENTIC] Get agents error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/agentic/execute
 * Execute a routed request
 */
router.post('/execute', async (req: Request, res: Response) => {
    try {
        const { prompt, agent, context, user_id } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt required' });
        }
        
        // Route if no agent specified
        let selectedAgent = agent;
        if (!selectedAgent) {
            const intent = classifyIntent(prompt, context || {});
            const scores = scoreAgents(intent, prompt, context || {});
            selectedAgent = selectOptimalAgent(scores, 'balanced').id;
        }
        
        // Execute with selected agent
        const result = await executeWithAgent(selectedAgent, prompt, context || {});
        
        res.json({
            success: result.success,
            response: result.response,
            agent_used: selectedAgent,
            execution_time_ms: result.execution_time_ms
        });
        
    } catch (error: any) {
        console.error('[AGENTIC] Execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// NVIDIA INTEGRATION ENDPOINTS
// ============================================

/**
 * POST /api/agentic/nvidia/chat
 * Chat with NVIDIA Nemotron models
 */
router.post('/nvidia/chat', async (req: Request, res: Response) => {
    try {
        const { prompt, model, system, temperature, max_tokens } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt required' });
        }
        
        const apiKey = process.env.NVIDIA_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'NVIDIA API key not configured' });
        }
        
        const modelId = model === 'nemotron-mini' 
            ? 'nvidia/nemotron-mini-4b-instruct'
            : 'nvidia/llama-3.1-nemotron-70b-instruct';
        
        const messages = [
            {
                role: 'system',
                content: system || 'You are a helpful AI assistant specialized in creative arts.'
            },
            {
                role: 'user',
                content: prompt
            }
        ];
        
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                temperature: temperature || 0.7,
                max_tokens: max_tokens || 2048,
                top_p: 0.9
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`NVIDIA API error: ${error}`);
        }
        
        const data: any = await response.json();
        
        res.json({
            success: true,
            response: data.choices?.[0]?.message?.content,
            model: modelId,
            usage: data.usage
        });
        
    } catch (error: any) {
        console.error('[NVIDIA] Chat error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/agentic/nvidia/embed
 * Generate embeddings with NVIDIA Nemo Retriever
 */
router.post('/nvidia/embed', async (req: Request, res: Response) => {
    try {
        const { text, model } = req.body;
        
        if (!text) {
            return res.status(400).json({ success: false, error: 'Text required' });
        }
        
        const apiKey = process.env.NVIDIA_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'NVIDIA API key not configured' });
        }
        
        const modelId = model || 'nvidia/nv-embedqa-e5-v5';
        const input = Array.isArray(text) ? text : [text];
        
        const response = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                input,
                input_type: 'query',
                encoding_format: 'float'
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`NVIDIA API error: ${error}`);
        }
        
        const data: any = await response.json();
        
        res.json({
            success: true,
            embeddings: data.data?.map((item: any) => item.embedding),
            model: modelId,
            dimensions: data.data?.[0]?.embedding?.length || 0,
            usage: data.usage
        });
        
    } catch (error: any) {
        console.error('[NVIDIA] Embed error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/agentic/nvidia/models
 * Get available NVIDIA models
 */
router.get('/nvidia/models', async (req: Request, res: Response) => {
    res.json({
        success: true,
        models: {
            'nemotron-70b': {
                id: 'nvidia/llama-3.1-nemotron-70b-instruct',
                type: 'chat',
                context_window: 128000,
                cost_per_1k_tokens: 0.0035
            },
            'nemotron-mini': {
                id: 'nvidia/nemotron-mini-4b-instruct',
                type: 'chat',
                context_window: 4096,
                cost_per_1k_tokens: 0.0003
            },
            'nemo-embedqa': {
                id: 'nvidia/nv-embedqa-e5-v5',
                type: 'embedding',
                dimensions: 1024,
                cost_per_1k_tokens: 0.0001
            }
        },
        configured: !!process.env.NVIDIA_API_KEY
    });
});

// ============================================
// PIPELINE ENDPOINTS
// ============================================

/**
 * POST /api/agentic/pipeline/execute
 * Execute the full unified pipeline
 */
router.post('/pipeline/execute', async (req: Request, res: Response) => {
    try {
        const { prompt, user_id, context } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt required' });
        }
        
        const startTime = Date.now();
        const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const stages: Record<string, any> = {};
        
        // Stage 1: Language Detection
        stages['language'] = detectLanguage(prompt);
        
        // Stage 2: Intent Classification
        stages['intent'] = classifyIntent(prompt, context || {});
        
        // Stage 3: Agent Routing
        const agentScores = scoreAgents(stages['intent'], prompt, context || {});
        stages['routing'] = {
            selected_agent: selectOptimalAgent(agentScores, 'balanced').id,
            scores: Object.fromEntries(Object.entries(agentScores).slice(0, 3))
        };
        
        // Stage 4: Complexity Assessment
        stages['complexity'] = assessComplexity(prompt);
        
        const totalTime = Date.now() - startTime;
        
        console.log(`[PIPELINE] Executed ${pipelineId} in ${totalTime}ms`);
        
        res.json({
            success: true,
            pipeline: {
                id: pipelineId,
                total_time_ms: totalTime,
                stages_completed: Object.keys(stages),
                version: '4.0.0'
            },
            stages,
            heartbeat: 'unified'
        });
        
    } catch (error: any) {
        console.error('[PIPELINE] Execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/agentic/pipeline/status
 * Get pipeline status
 */
router.get('/pipeline/status', async (req: Request, res: Response) => {
    res.json({
        success: true,
        status: {
            version: '4.0.0',
            stages: [
                'language_processing',
                'knowledge_enrichment',
                'intent_classification',
                'agent_routing',
                'cost_optimization',
                'evolution_enhancement',
                'vault_secret_sauce',
                'generation_execution',
                'quality_assessment',
                'learning_feedback'
            ],
            components: {
                nvidia: !!process.env.NVIDIA_API_KEY,
                runpod: !!process.env.RUNPOD_API_KEY,
                openai: !!process.env.OPENAI_API_KEY
            },
            heartbeat: 'unified'
        }
    });
});

/**
 * POST /api/agentic/webhook/wordpress
 * Webhook from WordPress for agentic events
 */
router.post('/webhook/wordpress', async (req: Request, res: Response) => {
    try {
        const { event, data, timestamp } = req.body;
        
        console.log(`[AGENTIC WEBHOOK] Received: ${event}`);
        
        // Process different event types
        switch (event) {
            case 'routing_complete':
                // Log routing decision for analytics
                console.log(`[AGENTIC] Routing: ${data.agent} for intent ${data.intent}`);
                break;
                
            case 'generation_complete':
                // Track generation metrics
                console.log(`[AGENTIC] Generation complete: ${data.pipeline_id}`);
                break;
                
            case 'feedback_received':
                // Process user feedback for learning
                console.log(`[AGENTIC] Feedback: ${data.rating} for ${data.generation_id}`);
                break;
                
            default:
                console.log(`[AGENTIC] Unknown event: ${event}`);
        }
        
        res.json({
            success: true,
            event,
            processed_at: new Date().toISOString()
        });
        
    } catch (error: any) {
        console.error('[AGENTIC WEBHOOK] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

interface Intent {
    type: string;
    confidence: number;
    patterns_matched: number;
    keywords_matched: number;
    primary_agent: string;
    fallback_agents: string[];
}

interface Agent {
    id: string;
    provider: string;
    type: string;
    capabilities: string[];
    quality_score: number;
    cost_per_request: number;
}

/**
 * Classify intent from prompt
 */
function classifyIntent(prompt: string, context: any): Intent {
    const promptLower = prompt.toLowerCase();
    
    const intentPatterns: Record<string, {
        patterns: RegExp[];
        keywords: string[];
        primary_agent: string;
        fallback_agents: string[];
        weight: number;
    }> = {
        'image_generation': {
            patterns: [
                /\b(create|generate|make|draw|paint|design|render|visualize)\b.*\b(image|art|artwork|picture|painting|illustration)\b/i,
                /\bstyle of\b|\bin the style\b/i,
                /\b(photorealistic|anime|watercolor|oil painting|digital art)\b/i
            ],
            keywords: ['create', 'generate', 'draw', 'paint', 'visualize', 'artwork', 'image'],
            primary_agent: 'huraii',
            fallback_agents: ['sdxl-turbo'],
            weight: 1.0
        },
        'complex_reasoning': {
            patterns: [
                /\b(explain|analyze|compare|evaluate|assess|understand)\b/i,
                /\b(why|how does|what if|could you explain)\b/i,
                /\b(step by step|detailed analysis|in depth)\b/i
            ],
            keywords: ['explain', 'analyze', 'compare', 'evaluate', 'reasoning', 'understand'],
            primary_agent: 'nemotron-70b',
            fallback_agents: ['llama-3-70b', 'mistral-large'],
            weight: 1.0
        },
        'market_analysis': {
            patterns: [
                /\b(price|value|worth|market|trend|sell|buy|invest)\b.*\b(art|nft|collection)\b/i,
                /\b(how much|estimate|appraise|valuation)\b/i
            ],
            keywords: ['price', 'value', 'market', 'trend', 'nft', 'worth'],
            primary_agent: 'cloe',
            fallback_agents: ['nemotron-70b'],
            weight: 1.0
        },
        'chat_assistance': {
            patterns: [
                /\b(help|how do i|where|what is|can you|tell me)\b/i,
                /\b(wallet|balance|transaction|payment|account)\b/i,
                /^(hi|hello|hey|good morning|good evening)/i
            ],
            keywords: ['help', 'how', 'where', 'what', 'wallet', 'balance', 'hello'],
            primary_agent: 'thorius',
            fallback_agents: ['nemotron-mini'],
            weight: 0.8
        }
    };
    
    let bestMatch: Intent = {
        type: 'chat_assistance',
        confidence: 0.3,
        patterns_matched: 0,
        keywords_matched: 0,
        primary_agent: 'thorius',
        fallback_agents: ['nemotron-mini']
    };
    
    for (const [intentType, config] of Object.entries(intentPatterns)) {
        let score = 0;
        let patternsMatched = 0;
        let keywordsMatched = 0;
        
        // Pattern matching
        for (const pattern of config.patterns) {
            if (pattern.test(prompt)) {
                score += 0.25;
                patternsMatched++;
            }
        }
        
        // Keyword matching
        for (const keyword of config.keywords) {
            if (promptLower.includes(keyword)) {
                keywordsMatched++;
            }
        }
        score += Math.min(keywordsMatched * 0.08, 0.4);
        
        // Apply weight
        score *= config.weight;
        
        const confidence = Math.min(score, 1.0);
        
        if (confidence > bestMatch.confidence) {
            bestMatch = {
                type: intentType,
                confidence,
                patterns_matched: patternsMatched,
                keywords_matched: keywordsMatched,
                primary_agent: config.primary_agent,
                fallback_agents: config.fallback_agents
            };
        }
    }
    
    return bestMatch;
}

/**
 * Score all agents for intent
 */
function scoreAgents(intent: Intent, prompt: string, context: any): Record<string, number> {
    const agents = getAvailableAgents();
    const scores: Record<string, number> = {};
    
    for (const [agentId, agent] of Object.entries(agents)) {
        let score = 0;
        
        // Primary agent bonus
        if (agentId === intent.primary_agent) {
            score += 0.5;
        } else if (intent.fallback_agents.includes(agentId)) {
            score += 0.3;
        }
        
        // Quality score contribution
        score += agent.quality_score * 0.2;
        
        // Cost efficiency (lower cost = higher score for economy mode)
        const costScore = 1 - Math.min(agent.cost_per_request / 0.1, 1);
        score += costScore * 0.1;
        
        scores[agentId] = Math.min(score, 1.0);
    }
    
    // Sort by score
    return Object.fromEntries(
        Object.entries(scores).sort(([, a], [, b]) => b - a)
    );
}

/**
 * Select optimal agent
 */
function selectOptimalAgent(scores: Record<string, number>, budgetMode: string): Agent {
    const agents = getAvailableAgents();
    const topAgentId = Object.keys(scores)[0] || 'thorius';
    
    return agents[topAgentId] || agents['thorius'];
}

/**
 * Get available agents
 */
function getAvailableAgents(): Record<string, Agent> {
    return {
        'nemotron-70b': {
            id: 'nemotron-70b',
            provider: 'nvidia',
            type: 'llm',
            capabilities: ['reasoning', 'instruction_following', 'code', 'analysis'],
            quality_score: 0.92,
            cost_per_request: 0.035
        },
        'nemotron-mini': {
            id: 'nemotron-mini',
            provider: 'nvidia',
            type: 'llm',
            capabilities: ['chat', 'quick_tasks', 'classification'],
            quality_score: 0.75,
            cost_per_request: 0.003
        },
        'huraii': {
            id: 'huraii',
            provider: 'vortex',
            type: 'generative_art',
            capabilities: ['image_generation', 'style_transfer', 'art_analysis'],
            quality_score: 0.85,
            cost_per_request: 0.05
        },
        'cloe': {
            id: 'cloe',
            provider: 'vortex',
            type: 'market_intelligence',
            capabilities: ['market_analysis', 'trend_prediction', 'pricing'],
            quality_score: 0.82,
            cost_per_request: 0.01
        },
        'thorius': {
            id: 'thorius',
            provider: 'vortex',
            type: 'concierge',
            capabilities: ['chat', 'guidance', 'navigation', 'wallet'],
            quality_score: 0.78,
            cost_per_request: 0.005
        },
        'llama-3-70b': {
            id: 'llama-3-70b',
            provider: 'runpod',
            type: 'llm',
            capabilities: ['reasoning', 'chat', 'code', 'multilingual'],
            quality_score: 0.88,
            cost_per_request: 0.02
        },
        'sdxl-turbo': {
            id: 'sdxl-turbo',
            provider: 'runpod',
            type: 'image_generation',
            capabilities: ['image_generation', 'fast_generation'],
            quality_score: 0.80,
            cost_per_request: 0.01
        }
    };
}

/**
 * Execute with agent
 */
async function executeWithAgent(agentId: string, prompt: string, context: any): Promise<any> {
    const startTime = Date.now();
    
    // For now, return a placeholder response
    // In production, this would call the actual agent
    return {
        success: true,
        response: `[${agentId}] Response to: ${prompt.substring(0, 50)}...`,
        execution_time_ms: Date.now() - startTime
    };
}

/**
 * Detect language
 */
function detectLanguage(text: string): { language: string; confidence: number } {
    // Simple detection based on character patterns
    const patterns: Record<string, RegExp> = {
        'zh': /[\u4E00-\u9FFF]/,
        'ja': /[\u3040-\u309F\u30A0-\u30FF]/,
        'ko': /[\uAC00-\uD7AF]/,
        'ar': /[\u0600-\u06FF]/,
        'ru': /[\u0400-\u04FF]/,
        'he': /[\u0590-\u05FF]/
    };
    
    for (const [lang, pattern] of Object.entries(patterns)) {
        if (pattern.test(text)) {
            return { language: lang, confidence: 0.9 };
        }
    }
    
    return { language: 'en', confidence: 0.8 };
}

/**
 * Assess complexity
 */
function assessComplexity(prompt: string): { level: string; score: number; factors: string[] } {
    const factors: string[] = [];
    let score = 0;
    
    // Length factor
    if (prompt.length > 200) {
        factors.push('long_prompt');
        score += 0.2;
    }
    
    // Multi-step indicators
    if (/\b(then|after|next|finally|step)\b/i.test(prompt)) {
        factors.push('multi_step');
        score += 0.3;
    }
    
    // Technical terms
    if (/\b(algorithm|function|api|database|architecture)\b/i.test(prompt)) {
        factors.push('technical');
        score += 0.2;
    }
    
    // Creative complexity
    if (/\b(style of|inspired by|fusion|combine|blend)\b/i.test(prompt)) {
        factors.push('creative_complexity');
        score += 0.2;
    }
    
    let level = 'simple';
    if (score > 0.6) level = 'complex';
    else if (score > 0.3) level = 'moderate';
    
    return { level, score: Math.min(score, 1.0), factors };
}

export default router;

