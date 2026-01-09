/**
 * VORTEX COSMOS AI Routes v4.0.0
 * 
 * SECRET SAUCE - Node.js Backend Routes
 * Physical Robot Embodiment API Endpoints
 * 
 * These routes handle:
 * - Robot authentication and registration
 * - User profile exports for robot embodiment
 * - Real-time robot communication
 * - Physical world transaction processing
 * - Sensor data ingestion
 * 
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Robot API Keys (loaded from environment)
 */
const VALID_ROBOT_KEYS = new Set<string>(
    (process.env.COSMOS_ROBOT_KEYS || '').split(',').filter(k => k.length > 0)
);

/**
 * Connected robots state
 */
const connectedRobots = new Map<string, {
    type: string;
    connectedAt: number;
    lastHeartbeat: number;
    status: string;
    galleryId?: string;
}>();

/**
 * Command queues for robots
 */
const robotCommandQueues = new Map<string, Array<{
    id: string;
    type: string;
    data: any;
    createdAt: number;
    status: string;
}>>();

/**
 * Sensor data buffer
 */
const sensorDataBuffer = new Map<string, Array<{
    timestamp: number;
    sensorType: string;
    data: any;
}>>();

/**
 * Middleware: Verify robot authentication
 */
const verifyRobotAuth = (req: Request, res: Response, next: Function) => {
    const robotKey = req.headers['x-cosmos-robot-key'] as string;
    
    if (!robotKey) {
        return res.status(401).json({
            error: 'Missing X-Cosmos-Robot-Key header',
            code: 'AUTH_MISSING'
        });
    }
    
    if (!VALID_ROBOT_KEYS.has(robotKey) && VALID_ROBOT_KEYS.size > 0) {
        return res.status(403).json({
            error: 'Invalid robot key',
            code: 'AUTH_INVALID'
        });
    }
    
    next();
};

/**
 * GET /api/cosmos/health
 * Health check endpoint (public)
 */
router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        version: '4.0.0',
        timestamp: Date.now(),
        connectedRobots: connectedRobots.size
    });
});

/**
 * POST /api/cosmos/robot/:robotId/connect
 * Connect a robot to the system
 */
router.post('/robot/:robotId/connect', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { type, galleryId, capabilities } = req.body;
    
    const robotType = type || 'hybrid_agent';
    
    connectedRobots.set(robotId, {
        type: robotType,
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
        status: 'connected',
        galleryId
    });
    
    // Initialize command queue
    if (!robotCommandQueues.has(robotId)) {
        robotCommandQueues.set(robotId, []);
    }
    
    // Initialize sensor buffer
    if (!sensorDataBuffer.has(robotId)) {
        sensorDataBuffer.set(robotId, []);
    }
    
    console.log(`[COSMOS] Robot connected: ${robotId} (${robotType})`);
    
    res.json({
        success: true,
        robotId,
        sessionId: `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: robotType,
        message: 'Robot connected successfully'
    });
});

/**
 * POST /api/cosmos/robot/:robotId/heartbeat
 * Robot heartbeat to maintain connection
 */
router.post('/robot/:robotId/heartbeat', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { status, metrics } = req.body;
    
    const robot = connectedRobots.get(robotId);
    
    if (!robot) {
        return res.status(404).json({
            error: 'Robot not connected',
            code: 'ROBOT_NOT_FOUND'
        });
    }
    
    robot.lastHeartbeat = Date.now();
    robot.status = status || 'active';
    
    // Get pending commands
    const pendingCommands = robotCommandQueues.get(robotId) || [];
    const commandsToSend = pendingCommands.filter(cmd => cmd.status === 'pending');
    
    // Mark commands as sent
    commandsToSend.forEach(cmd => cmd.status = 'sent');
    
    res.json({
        success: true,
        timestamp: Date.now(),
        commands: commandsToSend,
        serverStatus: 'healthy'
    });
});

/**
 * POST /api/cosmos/robot/:robotId/disconnect
 * Disconnect a robot from the system
 */
router.post('/robot/:robotId/disconnect', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    
    connectedRobots.delete(robotId);
    robotCommandQueues.delete(robotId);
    sensorDataBuffer.delete(robotId);
    
    console.log(`[COSMOS] Robot disconnected: ${robotId}`);
    
    res.json({
        success: true,
        robotId,
        message: 'Robot disconnected'
    });
});

/**
 * GET /api/cosmos/robot/:robotId/status
 * Get robot status
 */
router.get('/robot/:robotId/status', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    
    const robot = connectedRobots.get(robotId);
    
    if (!robot) {
        return res.status(404).json({
            error: 'Robot not found',
            status: 'disconnected'
        });
    }
    
    const pendingCommands = robotCommandQueues.get(robotId) || [];
    
    res.json({
        success: true,
        robotId,
        status: robot.status,
        type: robot.type,
        connectedAt: robot.connectedAt,
        lastHeartbeat: robot.lastHeartbeat,
        uptimeMs: Date.now() - robot.connectedAt,
        pendingCommands: pendingCommands.filter(cmd => cmd.status === 'pending').length
    });
});

/**
 * POST /api/cosmos/robot/:robotId/command
 * Send command to robot
 */
router.post('/robot/:robotId/command', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { type, data, priority } = req.body;
    
    const robot = connectedRobots.get(robotId);
    
    if (!robot) {
        return res.status(404).json({
            error: 'Robot not connected',
            code: 'ROBOT_NOT_FOUND'
        });
    }
    
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const command = {
        id: commandId,
        type,
        data,
        createdAt: Date.now(),
        status: 'pending'
    };
    
    const queue = robotCommandQueues.get(robotId) || [];
    
    if (priority === 'high') {
        queue.unshift(command);
    } else {
        queue.push(command);
    }
    
    robotCommandQueues.set(robotId, queue);
    
    res.json({
        success: true,
        commandId,
        status: 'queued',
        queuePosition: queue.indexOf(command) + 1
    });
});

/**
 * POST /api/cosmos/robot/:robotId/sensor
 * Receive sensor data from robot
 */
router.post('/robot/:robotId/sensor', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { sensorType, data, timestamp } = req.body;
    
    // Store sensor data
    const buffer = sensorDataBuffer.get(robotId) || [];
    buffer.push({
        timestamp: timestamp || Date.now(),
        sensorType,
        data
    });
    
    // Keep buffer size manageable
    if (buffer.length > 1000) {
        buffer.splice(0, buffer.length - 1000);
    }
    
    sensorDataBuffer.set(robotId, buffer);
    
    // Process sensor data and determine actions
    const actions = processSensorData(robotId, sensorType, data);
    
    res.json({
        success: true,
        processed: true,
        actions
    });
});

/**
 * POST /api/cosmos/robot/:robotId/speak
 * Generate speech for robot
 */
router.post('/robot/:robotId/speak', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { text, voiceProfile, emotion, userId, language } = req.body;
    
    // Personalize text if user ID provided
    let processedText = text;
    if (userId) {
        processedText = personalizeText(text, userId);
    }
    
    // Generate SSML
    const ssml = generateSSML(processedText, voiceProfile || 'adaptive', emotion || 'neutral');
    
    // Voice configuration
    const voiceConfig = getVoiceConfig(voiceProfile || 'adaptive');
    
    res.json({
        success: true,
        text: processedText,
        ssml,
        voiceConfig,
        emotion: emotion || 'neutral',
        language: language || 'en-US'
    });
});

/**
 * POST /api/cosmos/robot/:robotId/move
 * Generate movement commands for robot
 */
router.post('/robot/:robotId/move', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { movementType, target, speed } = req.body;
    
    const movementPatterns: Record<string, any> = {
        'greeting': {
            type: 'gesture',
            duration_ms: 2000,
            joints: ['arm_right', 'head', 'torso']
        },
        'pointing': {
            type: 'gesture',
            duration_ms: 1500,
            joints: ['arm_right', 'wrist', 'finger']
        },
        'escorting': {
            type: 'locomotion',
            speed: 'user_matched',
            distance: '1.5m'
        },
        'presenting': {
            type: 'gesture',
            duration_ms: 1800,
            joints: ['arm_both', 'torso']
        },
        'painting': {
            type: 'precision',
            precision: '0.1mm',
            joints: ['arm_right', 'wrist', 'gripper']
        }
    };
    
    const movement = movementPatterns[movementType] || movementPatterns['greeting'];
    
    // Calculate trajectory
    const trajectory = calculateTrajectory(movement, target);
    
    res.json({
        success: true,
        movementType,
        movement,
        target,
        speed: speed || 'normal',
        trajectory
    });
});

/**
 * POST /api/cosmos/robot/:robotId/create
 * Generate art creation plan for robot
 */
router.post('/robot/:robotId/create', verifyRobotAuth, (req: Request, res: Response) => {
    const { robotId } = req.params;
    const { artType, style, prompt, userId, collaborative } = req.body;
    
    const creationPlans: Record<string, any> = {
        'painting': {
            estimatedDurationMinutes: 45,
            materials: ['canvas', 'acrylic_paints', 'brushes', 'palette'],
            steps: [
                { step: 1, action: 'prepare_canvas', duration: 2 },
                { step: 2, action: 'mix_colors', duration: 5 },
                { step: 3, action: 'base_layer', duration: 10 },
                { step: 4, action: 'detail_work', duration: 20 },
                { step: 5, action: 'finishing_touches', duration: 5 },
                { step: 6, action: 'drying_time', duration: 3 }
            ]
        },
        'sculpting': {
            estimatedDurationMinutes: 60,
            materials: ['clay', 'sculpting_tools', 'armature', 'turntable'],
            steps: [
                { step: 1, action: 'prepare_armature', duration: 5 },
                { step: 2, action: 'apply_base_clay', duration: 10 },
                { step: 3, action: 'rough_shaping', duration: 15 },
                { step: 4, action: 'detail_sculpting', duration: 20 },
                { step: 5, action: 'surface_finishing', duration: 10 }
            ]
        },
        'digital_print': {
            estimatedDurationMinutes: 15,
            materials: ['printer', 'art_paper', 'ink_cartridges'],
            steps: [
                { step: 1, action: 'generate_digital', duration: 5 },
                { step: 2, action: 'prepare_printer', duration: 2 },
                { step: 3, action: 'print', duration: 5 },
                { step: 4, action: 'quality_check', duration: 2 },
                { step: 5, action: 'sign_artwork', duration: 1 }
            ]
        }
    };
    
    const plan = creationPlans[artType] || creationPlans['painting'];
    
    res.json({
        success: true,
        robotId,
        artType,
        style,
        prompt,
        userId,
        collaborative: collaborative || false,
        creationPlan: plan,
        estimatedTime: plan.estimatedDurationMinutes,
        steps: plan.steps,
        materialsRequired: plan.materials
    });
});

/**
 * POST /api/cosmos/transaction/initiate
 * Initiate a transaction from robot
 */
router.post('/transaction/initiate', verifyRobotAuth, (req: Request, res: Response) => {
    const { userId, artworkId, amount, robotId, paymentMethod } = req.body;
    
    const transactionId = `cosmos_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store transaction
    const transaction = {
        id: transactionId,
        userId,
        artworkId,
        amount,
        robotId,
        paymentMethod: paymentMethod || 'usdc_balance',
        status: 'pending',
        createdAt: Date.now()
    };
    
    console.log(`[COSMOS] Transaction initiated: ${transactionId}`, transaction);
    
    res.json({
        success: true,
        transactionId,
        status: 'pending',
        nextStep: paymentMethod === 'usdc_balance' ? 'confirm_balance_deduction' : 'await_payment',
        expiresAt: Date.now() + 3600000 // 1 hour
    });
});

/**
 * POST /api/cosmos/transaction/:transactionId/confirm
 * Confirm a transaction
 */
router.post('/transaction/:transactionId/confirm', verifyRobotAuth, (req: Request, res: Response) => {
    const { transactionId } = req.params;
    const { confirmationCode, userId } = req.body;
    
    // In production, verify confirmation and process payment
    
    res.json({
        success: true,
        transactionId,
        status: 'confirmed',
        message: 'Transaction confirmed successfully'
    });
});

/**
 * GET /api/cosmos/user/:userId/export
 * Export user profile for robot embodiment
 */
router.get('/user/:userId/export', verifyRobotAuth, (req: Request, res: Response) => {
    const { userId } = req.params;
    const { robotType } = req.query;
    
    // In production, fetch from WordPress API
    const mockProfile = {
        userId: parseInt(userId as string),
        robotType: robotType || 'hybrid_agent',
        profile: {
            identity: {
                displayName: 'User',
                avatar: null,
                zodiac: null,
                personalityType: 'explorer'
            },
            interaction: {
                preferredFormality: 'adaptive',
                conversationPace: 'moderate',
                detailPreference: 'balanced',
                humorReceptivity: 'moderate'
            },
            creationProfile: {
                favoriteStyles: [],
                colorPreferences: [],
                complexityPreference: 'moderate'
            },
            purchaseProfile: {
                priceSensitivity: 'moderate',
                decisionMakingSpeed: 'considered',
                socialProofInfluence: 'moderate'
            }
        },
        realTimeState: {
            currentMood: 'neutral',
            currentIntent: 'browsing',
            lastInteraction: Date.now()
        },
        exportTimestamp: Date.now(),
        validUntil: Date.now() + 3600000
    };
    
    res.json({
        success: true,
        ...mockProfile
    });
});

/**
 * GET /api/cosmos/robots
 * List all connected robots
 */
router.get('/robots', verifyRobotAuth, (req: Request, res: Response) => {
    const robots = Array.from(connectedRobots.entries()).map(([id, data]) => ({
        id,
        ...data,
        uptimeMs: Date.now() - data.connectedAt
    }));
    
    res.json({
        success: true,
        count: robots.length,
        robots
    });
});

// Helper functions

function processSensorData(robotId: string, sensorType: string, data: any): any[] {
    const actions: any[] = [];
    
    if (sensorType === 'proximity' && data.distance < 5) {
        actions.push({
            type: 'greeting',
            priority: 'high',
            params: { zone: data.distance < 1.5 ? 'personal' : 'social' }
        });
    }
    
    if (sensorType === 'camera' && data.facesDetected > 0) {
        actions.push({
            type: 'face_detected',
            priority: 'medium',
            params: { count: data.facesDetected }
        });
    }
    
    if (sensorType === 'microphone' && data.speechDetected) {
        actions.push({
            type: 'process_speech',
            priority: 'immediate',
            params: { transcript: data.transcript }
        });
    }
    
    return actions;
}

function personalizeText(text: string, userId: number): string {
    // In production, fetch user data and personalize
    return text.replace(/{user_name}/g, 'Guest')
               .replace(/{first_name}/g, 'Friend');
}

function generateSSML(text: string, voiceProfile: string, emotion: string): string {
    const pitch = voiceProfile === 'professional_persuasive' ? '+5%' : '+0%';
    const rate = voiceProfile === 'educational_warm' ? '0.9' : '1.0';
    
    let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis">`;
    ssml += `<prosody pitch="${pitch}" rate="${rate}">`;
    
    if (emotion !== 'neutral') {
        ssml += `<amazon:emotion name="${emotion}" intensity="medium">`;
    }
    
    ssml += escapeXml(text);
    
    if (emotion !== 'neutral') {
        ssml += `</amazon:emotion>`;
    }
    
    ssml += `</prosody></speak>`;
    
    return ssml;
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getVoiceConfig(voiceProfile: string): any {
    const configs: Record<string, any> = {
        'artistic_passionate': {
            pitch: 'medium',
            speed: 'moderate',
            tone: 'warm_expressive',
            vocabulary: 'artistic_creative'
        },
        'educational_warm': {
            pitch: 'medium_low',
            speed: 'measured',
            tone: 'knowledgeable_friendly',
            vocabulary: 'educational_accessible'
        },
        'professional_persuasive': {
            pitch: 'medium',
            speed: 'confident',
            tone: 'professional_engaging',
            vocabulary: 'business_refined'
        },
        'adaptive': {
            pitch: 'dynamic',
            speed: 'context_aware',
            tone: 'matching_user',
            vocabulary: 'full_range'
        }
    };
    
    return configs[voiceProfile] || configs['adaptive'];
}

function calculateTrajectory(movement: any, target: any): any {
    if (movement.type === 'gesture') {
        return {
            type: 'gesture',
            keyframes: [
                { time: 0, joints: {} },
                { time: movement.duration_ms / 2, joints: {} },
                { time: movement.duration_ms, joints: {} }
            ],
            duration_ms: movement.duration_ms
        };
    }
    
    if (movement.type === 'locomotion') {
        return {
            type: 'locomotion',
            waypoints: target ? [target] : [],
            speed: movement.speed,
            obstacleAvoidance: true
        };
    }
    
    return { type: movement.type };
}

export default router;

