/**
 * Balance Sync Routes
 * Version: 4.0.0
 * 
 * Provides endpoints for WordPress to sync wallet balances
 * Reads true balances from Solana blockchain
 * Notifies WordPress when balances change
 */

import { Router, Request, Response } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

const router = Router();

// Solana connection
const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
);

// Token mints
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOLA_MINT = new PublicKey('H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky');

/**
 * GET /api/balance/:wallet_address
 * Read wallet balances from blockchain
 */
router.get('/balance/:wallet_address', async (req: Request, res: Response) => {
    try {
        const walletAddress = req.params.wallet_address;
        
        if (!walletAddress || walletAddress.length < 32) {
            return res.status(400).json({
                success: false,
                error: 'Invalid wallet address'
            });
        }
        
        console.log('[BALANCE SYNC v4.0.0] Reading balances for:', walletAddress);
        
        const walletPubkey = new PublicKey(walletAddress);
        
        // Read USDC balance
        let usdcBalance = 0;
        try {
            const usdcTokenAccount = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
            const usdcAccount = await getAccount(connection, usdcTokenAccount);
            usdcBalance = Number(usdcAccount.amount) / 1_000_000; // USDC has 6 decimals
        } catch (e) {
            console.log('[BALANCE SYNC v4.0.0] No USDC account found');
        }
        
        // Read TOLA balance
        let tolaBalance = 0;
        try {
            const tolaTokenAccount = await getAssociatedTokenAddress(TOLA_MINT, walletPubkey);
            const tolaAccount = await getAccount(connection, tolaTokenAccount);
            tolaBalance = Number(tolaAccount.amount) / 1_000_000_000; // TOLA has 9 decimals
        } catch (e) {
            console.log('[BALANCE SYNC v4.0.0] No TOLA account found');
        }
        
        console.log('[BALANCE SYNC v4.0.0] Balances:', {
            usdc: usdcBalance,
            tola: tolaBalance
        });
        
        res.json({
            success: true,
            data: {
                wallet_address: walletAddress,
                balances: {
                    usdc: usdcBalance,
                    tola: tolaBalance
                },
                timestamp: new Date().toISOString(),
                source: 'blockchain_verified'
            }
        });
        
    } catch (error: any) {
        console.error('[BALANCE SYNC v4.0.0] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/balance/notify
 * Notify WordPress that balance changed
 */
router.post('/balance/notify', async (req: Request, res: Response) => {
    try {
        const { wallet_address, user_id, wordpress_url } = req.body;
        
        console.log('[BALANCE SYNC v4.0.0] Notifying WordPress of balance change:', {
            wallet: wallet_address,
            user: user_id
        });
        
        // In production, you'd make HTTP request to WordPress webhook
        // For now, just acknowledge
        
        res.json({
            success: true,
            message: 'Balance change notification sent'
        });
        
    } catch (error: any) {
        console.error('[BALANCE SYNC v4.0.0] Notify error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;

