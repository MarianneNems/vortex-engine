/**
 * Vortex Engine - USDC Spending Routes
 * 
 * Handles spending tracking and correlation between WordPress and blockchain
 * All spending is recorded in USDC
 * 
 * @package VortexEngine
 * @version 4.0.0
 * @since 4.0.0
 */

import { Router, Request, Response } from 'express';

const router = Router();

interface SpendingRecord {
    user_id: number;
    wallet_address: string;
    amount: number;
    type: string;
    provider?: string;
    timestamp: string;
    currency: string;
}

interface SpendingStore {
    [userId: string]: SpendingRecord[];
}

// In-memory store for spending records (in production, use database)
const spendingRecords: SpendingStore = {};

/**
 * Record a spending event from WordPress
 * POST /api/spending/record
 */
router.post('/record', (req: Request, res: Response) => {
    try {
        const { user_id, wallet_address, amount, type, provider, timestamp, currency } = req.body;

        if (!user_id || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: user_id and amount'
            });
        }

        const record: SpendingRecord = {
            user_id,
            wallet_address: wallet_address || '',
            amount: parseFloat(amount),
            type: type || 'ai_generation',
            provider: provider || 'default',
            timestamp: timestamp || new Date().toISOString(),
            currency: currency || 'USDC'
        };

        // Store the record
        const userKey = String(user_id);
        if (!spendingRecords[userKey]) {
            spendingRecords[userKey] = [];
        }
        spendingRecords[userKey].push(record);

        console.log(`[SPENDING] Recorded: User ${user_id} | ${amount} ${record.currency} | ${type}`);

        return res.status(200).json({
            success: true,
            message: 'Spending recorded',
            record
        });

    } catch (error: any) {
        console.error('[SPENDING] Record error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Get spending history for a user
 * GET /api/spending/history/:user_id
 */
router.get('/history/:user_id', (req: Request, res: Response) => {
    try {
        const { user_id } = req.params;
        const { from, to, limit } = req.query;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID required'
            });
        }

        const userKey = String(user_id);
        let records = spendingRecords[userKey] || [];

        // Filter by date range if provided
        if (from) {
            const fromDate = new Date(from as string);
            records = records.filter(r => new Date(r.timestamp) >= fromDate);
        }
        if (to) {
            const toDate = new Date(to as string);
            records = records.filter(r => new Date(r.timestamp) <= toDate);
        }

        // Limit results
        const recordLimit = parseInt(limit as string) || 100;
        records = records.slice(-recordLimit);

        // Calculate totals
        const totalSpent = records.reduce((sum, r) => sum + r.amount, 0);

        return res.status(200).json({
            success: true,
            user_id,
            total_spent: totalSpent,
            currency: 'USDC',
            record_count: records.length,
            records
        });

    } catch (error: any) {
        console.error('[SPENDING] History error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Get spending summary for a user
 * GET /api/spending/summary/:user_id
 */
router.get('/summary/:user_id', (req: Request, res: Response) => {
    try {
        const { user_id } = req.params;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID required'
            });
        }

        const userKey = String(user_id);
        const records = spendingRecords[userKey] || [];

        // Calculate monthly spending
        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyRecords = records.filter(r => new Date(r.timestamp) >= firstOfMonth);
        const monthlySpent = monthlyRecords.reduce((sum, r) => sum + r.amount, 0);

        // Calculate all-time spending
        const totalSpent = records.reduce((sum, r) => sum + r.amount, 0);

        // Calculate by type
        const byType: { [key: string]: number } = {};
        records.forEach(r => {
            byType[r.type] = (byType[r.type] || 0) + r.amount;
        });

        // Calculate by provider
        const byProvider: { [key: string]: number } = {};
        records.forEach(r => {
            if (r.provider) {
                byProvider[r.provider] = (byProvider[r.provider] || 0) + r.amount;
            }
        });

        return res.status(200).json({
            success: true,
            user_id,
            currency: 'USDC',
            summary: {
                monthly_spent: monthlySpent,
                total_spent: totalSpent,
                transaction_count: records.length,
                by_type: byType,
                by_provider: byProvider
            }
        });

    } catch (error: any) {
        console.error('[SPENDING] Summary error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Webhook for WordPress spending notifications
 * POST /api/spending/webhook
 */
router.post('/webhook', (req: Request, res: Response) => {
    try {
        console.log('[SPENDING WEBHOOK] Received:', req.body);

        const { user_id, wallet_address, amount, type, provider } = req.body;

        if (!user_id || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const record: SpendingRecord = {
            user_id,
            wallet_address: wallet_address || '',
            amount: parseFloat(amount),
            type: type || 'webhook_spending',
            provider: provider || 'wordpress',
            timestamp: new Date().toISOString(),
            currency: 'USDC'
        };

        const userKey = String(user_id);
        if (!spendingRecords[userKey]) {
            spendingRecords[userKey] = [];
        }
        spendingRecords[userKey].push(record);

        console.log(`[SPENDING WEBHOOK] Processed: User ${user_id} | ${amount} USDC`);

        return res.status(200).json({
            success: true,
            message: 'Spending webhook processed',
            record
        });

    } catch (error: any) {
        console.error('[SPENDING WEBHOOK] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Record vendor earning (WCFM commission)
 * POST /api/spending/earning
 */
router.post('/earning', (req: Request, res: Response) => {
    try {
        const { user_id, amount, order_id, description, type } = req.body;

        if (!user_id || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: user_id and amount'
            });
        }

        const record: SpendingRecord = {
            user_id,
            wallet_address: '',
            amount: parseFloat(amount),
            type: type || 'earning',
            provider: 'wcfm',
            timestamp: new Date().toISOString(),
            currency: 'USDC'
        };

        // Store as negative spending (earning)
        const userKey = String(user_id);
        if (!spendingRecords[userKey]) {
            spendingRecords[userKey] = [];
        }
        
        // Mark as earning with negative amount for tracking
        const earningRecord = {
            ...record,
            amount: -Math.abs(record.amount), // Negative = earning
            type: 'wcfm_commission'
        };
        spendingRecords[userKey].push(earningRecord);

        console.log(`[EARNING] Recorded: Vendor ${user_id} earned ${amount} USDC from order ${order_id}`);

        return res.status(200).json({
            success: true,
            message: 'Earning recorded',
            user_id,
            amount,
            order_id,
            type: 'earning',
            recorded_at: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('[EARNING] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Get earnings summary for a vendor
 * GET /api/spending/earnings/:user_id
 */
router.get('/earnings/:user_id', (req: Request, res: Response) => {
    try {
        const { user_id } = req.params;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID required'
            });
        }

        const userKey = String(user_id);
        const records = spendingRecords[userKey] || [];
        
        // Filter earnings (negative amounts or wcfm_commission type)
        const earnings = records.filter(r => 
            r.amount < 0 || r.type === 'wcfm_commission' || r.type === 'earning'
        );

        const totalEarnings = earnings.reduce((sum, r) => sum + Math.abs(r.amount), 0);

        return res.status(200).json({
            success: true,
            user_id,
            currency: 'USDC',
            total_earnings: totalEarnings,
            earning_count: earnings.length,
            earnings: earnings.map(e => ({
                ...e,
                amount: Math.abs(e.amount)
            }))
        });

    } catch (error: any) {
        console.error('[EARNINGS] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

export default router;

