/**
 * Vortex TOLA-ART Masterpiece Routes
 * 
 * API endpoints for TOLA-ART Daily Masterpiece system
 * 
 * MINTING:
 * - NFT minted exclusively on TOLA (Solana incentive token)
 * - Starting price: 900 USDC
 * - Payment accepted in USDC only
 * 
 * FEATURES:
 * - Daily draw automation at midnight Miami time (00:00 America/New_York)
 * - Secondary sale royalty distribution in USDC
 * - Participant tracking
 * - Distribution queue processing
 * 
 * ROYALTIES:
 * - 5% Platform (on-chain TOLA)
 * - 15% Artists (divided equally)
 * - First Sale: 15% platform (135 USDC) + 85% artists (765 USDC)
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { 
    getAssociatedTokenAddress,
    createTransferInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';

const router = Router();

// USDC Mint on Solana mainnet
const USDC_MINT = new PublicKey(process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Platform wallet for TOLA operations
const PLATFORM_WALLET = process.env.PLATFORM_TREASURY_PUBKEY || '6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g';

// Interfaces
interface RoyaltyDistributionRequest {
    masterpiece_id: number;
    sale_signature: string;
    sale_price: number;
    royalty_amount: number;
    participants: Array<{
        user_id: number;
        wallet_address: string;
        share_amount: number;
    }>;
}

interface MasterpieceWebhook {
    masterpiece_id: number;
    timestamp: string;
    event_type: 'created' | 'sold' | 'royalty';
    data?: any;
}

/**
 * POST /api/tola-masterpiece/distribute-royalty
 * Process royalty distribution to participating artists
 */
router.post('/distribute-royalty', async (req: Request, res: Response) => {
    try {
        const body = req.body as RoyaltyDistributionRequest;
        
        if (!body.masterpiece_id || !body.participants || body.participants.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: masterpiece_id, participants'
            });
        }
        
        console.log('[TOLA MASTERPIECE] Distributing royalties:', {
            masterpiece_id: body.masterpiece_id,
            sale_signature: body.sale_signature?.substring(0, 20) + '...',
            royalty_amount: body.royalty_amount,
            participant_count: body.participants.length
        });
        
        const connection = new Connection(
            process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
            'confirmed'
        );
        
        // Treasury keypair for distributions
        if (!process.env.TREASURY_WALLET_PRIVATE) {
            return res.status(500).json({
                success: false,
                error: 'Treasury wallet not configured'
            });
        }
        
        const treasuryKeypair = Keypair.fromSecretKey(
            bs58.decode(process.env.TREASURY_WALLET_PRIVATE)
        );
        
        const results: Array<{
            user_id: number;
            wallet: string;
            amount: number;
            signature?: string;
            error?: string;
        }> = [];
        
        // Process each participant
        for (const participant of body.participants) {
            try {
                // Skip if amount too small (< 0.001 USDC = 1000 lamports)
                if (participant.share_amount < 0.001) {
                    results.push({
                        user_id: participant.user_id,
                        wallet: participant.wallet_address,
                        amount: participant.share_amount,
                        error: 'Amount too small to transfer'
                    });
                    continue;
                }
                
                const recipientPubkey = new PublicKey(participant.wallet_address);
                
                // Get ATAs
                const treasuryATA = await getAssociatedTokenAddress(
                    USDC_MINT,
                    treasuryKeypair.publicKey
                );
                
                const recipientATA = await getAssociatedTokenAddress(
                    USDC_MINT,
                    recipientPubkey
                );
                
                // Amount in USDC smallest units (6 decimals)
                const amountLamports = Math.floor(participant.share_amount * 1_000_000);
                
                // Create transfer instruction
                const transferIx = createTransferInstruction(
                    treasuryATA,
                    recipientATA,
                    treasuryKeypair.publicKey,
                    amountLamports,
                    [],
                    TOKEN_PROGRAM_ID
                );
                
                // Build and send transaction
                const { Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
                const tx = new Transaction().add(transferIx);
                
                const signature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair]);
                
                results.push({
                    user_id: participant.user_id,
                    wallet: participant.wallet_address,
                    amount: participant.share_amount,
                    signature
                });
                
                console.log(`[TOLA MASTERPIECE] Sent ${participant.share_amount} USDC to ${participant.wallet_address.substring(0, 8)}...`);
                
            } catch (err: any) {
                results.push({
                    user_id: participant.user_id,
                    wallet: participant.wallet_address,
                    amount: participant.share_amount,
                    error: err.message
                });
                console.error(`[TOLA MASTERPIECE] Transfer failed for user ${participant.user_id}:`, err.message);
            }
        }
        
        const successful = results.filter(r => r.signature).length;
        const failed = results.filter(r => r.error).length;
        
        console.log(`[TOLA MASTERPIECE] Distribution complete: ${successful} succeeded, ${failed} failed`);
        
        return res.status(200).json({
            success: true,
            masterpiece_id: body.masterpiece_id,
            total_distributed: results.filter(r => r.signature).reduce((sum, r) => sum + r.amount, 0),
            successful_count: successful,
            failed_count: failed,
            results
        });
        
    } catch (error: any) {
        console.error('[TOLA MASTERPIECE] Distribution error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Distribution failed'
        });
    }
});

/**
 * POST /api/tola-masterpiece/verify-secondary-sale
 * Verify and process a secondary market sale royalty
 */
router.post('/verify-secondary-sale', async (req: Request, res: Response) => {
    try {
        const { mint_address, signature } = req.body;
        
        if (!mint_address || !signature) {
            return res.status(400).json({
                success: false,
                error: 'Missing mint_address or signature'
            });
        }
        
        console.log('[TOLA MASTERPIECE] Verifying secondary sale:', {
            mint: mint_address.substring(0, 20) + '...',
            sig: signature.substring(0, 20) + '...'
        });
        
        const connection = new Connection(
            process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
            'confirmed'
        );
        
        // Get transaction details
        const txInfo = await connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0
        });
        
        if (!txInfo) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found'
            });
        }
        
        // Extract sale price from transaction
        // This is simplified - in production you'd parse marketplace-specific data
        const preBalances = txInfo.meta?.preBalances || [];
        const postBalances = txInfo.meta?.postBalances || [];
        
        let salePrice = 0;
        for (let i = 0; i < preBalances.length; i++) {
            const diff = postBalances[i] - preBalances[i];
            if (diff > 0 && diff > salePrice) {
                salePrice = diff / 1_000_000_000; // SOL to lamports
            }
        }
        
        return res.status(200).json({
            success: true,
            mint_address,
            signature,
            sale_price_sol: salePrice,
            block_time: txInfo.blockTime,
            slot: txInfo.slot
        });
        
    } catch (error: any) {
        console.error('[TOLA MASTERPIECE] Verification error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Verification failed'
        });
    }
});

/**
 * GET /api/tola-masterpiece/status
 * Get TOLA-ART system status
 */
router.get('/status', (req: Request, res: Response) => {
    // Calculate next midnight Miami time
    const now = new Date();
    const miamiOffset = -5 * 60; // EST offset in minutes
    const miamiNow = new Date(now.getTime() + miamiOffset * 60000);
    
    const nextMidnight = new Date(miamiNow);
    nextMidnight.setHours(24, 0, 0, 0);
    
    const msUntilDraw = nextMidnight.getTime() - miamiNow.getTime();
    const hoursUntil = Math.floor(msUntilDraw / (1000 * 60 * 60));
    const minutesUntil = Math.floor((msUntilDraw % (1000 * 60 * 60)) / (1000 * 60));
    
    return res.status(200).json({
        success: true,
        system: 'TOLA-ART Masterpiece v4.0.0',
        schedule: 'Daily at 00:00 Miami/Eastern Time',
        timezone: 'America/New_York',
        current_time_miami: miamiNow.toISOString(),
        next_draw_in: `${hoursUntil}h ${minutesUntil}m`,
        minting: {
            token: 'TOLA',
            network: 'Solana',
            payment_currency: 'USDC',
            starting_price: 900
        },
        royalty_structure: {
            platform_royalty: '5% (fixed on-chain TOLA)',
            artist_royalties: '15% (divided among participants)',
            first_sale_platform: '15% commission (135 USDC)',
            first_sale_artists: '85% distributed equally (765 USDC)',
            total_seller_fee: '20% (2000 basis points)'
        },
        first_sale_distribution: {
            total_price: 900,
            platform_commission: 135,
            artist_pool: 765,
            currency: 'USDC'
        },
        endpoints: {
            distribute_royalty: 'POST /api/tola-masterpiece/distribute-royalty',
            verify_sale: 'POST /api/tola-masterpiece/verify-secondary-sale',
            status: 'GET /api/tola-masterpiece/status'
        }
    });
});

/**
 * WordPress Webhook: New masterpiece created
 */
router.post('/webhook/created', (req: Request, res: Response) => {
    const body = req.body as MasterpieceWebhook;
    
    console.log('[TOLA MASTERPIECE WEBHOOK] New masterpiece created:', {
        masterpiece_id: body.masterpiece_id,
        timestamp: body.timestamp
    });
    
    // In production: Could trigger notifications, analytics, etc.
    
    return res.status(200).json({
        success: true,
        message: 'Webhook received'
    });
});

/**
 * WordPress Webhook: Masterpiece sold
 */
router.post('/webhook/sold', (req: Request, res: Response) => {
    const body = req.body as MasterpieceWebhook;
    
    console.log('[TOLA MASTERPIECE WEBHOOK] Masterpiece sold:', {
        masterpiece_id: body.masterpiece_id,
        timestamp: body.timestamp,
        data: body.data
    });
    
    // In production: Could trigger analytics, leaderboards, etc.
    
    return res.status(200).json({
        success: true,
        message: 'Sale webhook received'
    });
});

export default router;

