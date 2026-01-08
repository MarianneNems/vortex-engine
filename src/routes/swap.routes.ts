/**
 * Vortex Swap Routes
 * 
 * Handles NFT swap transactions on Solana blockchain
 * 
 * RULES:
 * - Only Artists can swap (validated on WordPress side)
 * - Swap fee: 5 USDC per user = 10 USDC total
 * - Hard ownership transfer on Solana
 * - User pays gas fee for on-chain transfer
 * - Collections limited to 9 NFTs max
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
    getAssociatedTokenAddress,
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    getAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';

const router = Router();

// Swap request interface
interface SwapExecuteRequest {
    swap_id: string;
    offered_nft_mint: string;
    requested_nft_mint: string;
    initiator_wallet: string;
    recipient_wallet: string;
    initiator_fee_usdc: number;
    recipient_fee_usdc: number;
}

// Collection swap request interface
interface CollectionSwapRequest {
    swap_id: string;
    offered_collection: {
        id: number;
        nft_mints: string[];
    };
    requested_collection: {
        id: number;
        nft_mints: string[];
    };
    initiator_wallet: string;
    recipient_wallet: string;
    initiator_fee_usdc: number;
    recipient_fee_usdc: number;
}

// Swap verification result
interface SwapVerifyResult {
    success: boolean;
    swap_id: string;
    status: 'pending' | 'completed' | 'failed';
    transactions?: {
        offered_transfer?: string;
        requested_transfer?: string;
    };
    error?: string;
}

/**
 * Execute single NFT swap
 * POST /api/swap/execute
 */
router.post('/execute', async (req: Request, res: Response) => {
    try {
        const body = req.body as SwapExecuteRequest;
        
        // Validate required fields
        if (!body.swap_id || !body.offered_nft_mint || !body.requested_nft_mint) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: swap_id, offered_nft_mint, requested_nft_mint'
            });
        }
        
        if (!body.initiator_wallet || !body.recipient_wallet) {
            return res.status(400).json({
                success: false,
                error: 'Missing wallet addresses'
            });
        }
        
        console.log('[SWAP] Execute request:', {
            swap_id: body.swap_id,
            offered_mint: body.offered_nft_mint.substring(0, 20) + '...',
            requested_mint: body.requested_nft_mint.substring(0, 20) + '...',
            initiator: body.initiator_wallet.substring(0, 20) + '...',
            recipient: body.recipient_wallet.substring(0, 20) + '...'
        });
        
        const connection = new Connection(
            process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
            'confirmed'
        );
        
        // Validate mint addresses
        let offeredMint: PublicKey;
        let requestedMint: PublicKey;
        let initiatorPubkey: PublicKey;
        let recipientPubkey: PublicKey;
        
        try {
            offeredMint = new PublicKey(body.offered_nft_mint);
            requestedMint = new PublicKey(body.requested_nft_mint);
            initiatorPubkey = new PublicKey(body.initiator_wallet);
            recipientPubkey = new PublicKey(body.recipient_wallet);
        } catch (err) {
            return res.status(400).json({
                success: false,
                error: 'Invalid public key format'
            });
        }
        
        // Get associated token accounts
        const initiatorOfferedATA = await getAssociatedTokenAddress(
            offeredMint,
            initiatorPubkey
        );
        
        const recipientOfferedATA = await getAssociatedTokenAddress(
            offeredMint,
            recipientPubkey
        );
        
        const initiatorRequestedATA = await getAssociatedTokenAddress(
            requestedMint,
            initiatorPubkey
        );
        
        const recipientRequestedATA = await getAssociatedTokenAddress(
            requestedMint,
            recipientPubkey
        );
        
        // Prepare transaction instructions
        // Note: Actual transfers require user wallet signatures
        // This returns the transaction data for frontend signing
        
        const transactionData = {
            swap_id: body.swap_id,
            instructions: {
                offered_transfer: {
                    from_wallet: body.initiator_wallet,
                    to_wallet: body.recipient_wallet,
                    mint: body.offered_nft_mint,
                    from_ata: initiatorOfferedATA.toString(),
                    to_ata: recipientOfferedATA.toString(),
                    amount: 1
                },
                requested_transfer: {
                    from_wallet: body.recipient_wallet,
                    to_wallet: body.initiator_wallet,
                    mint: body.requested_nft_mint,
                    from_ata: recipientRequestedATA.toString(),
                    to_ata: initiatorRequestedATA.toString(),
                    amount: 1
                }
            },
            fees: {
                initiator_usdc: body.initiator_fee_usdc || 5.00,
                recipient_usdc: body.recipient_fee_usdc || 5.00,
                total_usdc: (body.initiator_fee_usdc || 5.00) + (body.recipient_fee_usdc || 5.00),
                estimated_gas_sol: 0.00005
            }
        };
        
        console.log('[SWAP] Transaction prepared:', body.swap_id);
        
        return res.status(200).json({
            success: true,
            swap_id: body.swap_id,
            status: 'instructions_ready',
            message: 'Swap transactions prepared. Both parties must sign.',
            transactions: transactionData.instructions,
            fees: transactionData.fees
        });
        
    } catch (error: any) {
        console.error('[SWAP] Execute error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Swap execution failed'
        });
    }
});

/**
 * Execute collection swap (multiple NFTs)
 * POST /api/swap/execute-collection
 */
router.post('/execute-collection', async (req: Request, res: Response) => {
    try {
        const body = req.body as CollectionSwapRequest;
        
        // Validate required fields
        if (!body.swap_id || !body.offered_collection || !body.requested_collection) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        // Validate collection sizes (max 9 NFTs each)
        const MAX_COLLECTION_SIZE = 9;
        
        if (body.offered_collection.nft_mints.length > MAX_COLLECTION_SIZE) {
            return res.status(400).json({
                success: false,
                error: `Offered collection exceeds maximum size of ${MAX_COLLECTION_SIZE} NFTs`
            });
        }
        
        if (body.requested_collection.nft_mints.length > MAX_COLLECTION_SIZE) {
            return res.status(400).json({
                success: false,
                error: `Requested collection exceeds maximum size of ${MAX_COLLECTION_SIZE} NFTs`
            });
        }
        
        console.log('[SWAP] Collection swap request:', {
            swap_id: body.swap_id,
            offered_count: body.offered_collection.nft_mints.length,
            requested_count: body.requested_collection.nft_mints.length
        });
        
        // Prepare batch transfer instructions
        const offeredTransfers = body.offered_collection.nft_mints.map((mint, index) => ({
            index,
            mint,
            from_wallet: body.initiator_wallet,
            to_wallet: body.recipient_wallet,
            direction: 'offered'
        }));
        
        const requestedTransfers = body.requested_collection.nft_mints.map((mint, index) => ({
            index,
            mint,
            from_wallet: body.recipient_wallet,
            to_wallet: body.initiator_wallet,
            direction: 'requested'
        }));
        
        const totalTransfers = offeredTransfers.length + requestedTransfers.length;
        
        return res.status(200).json({
            success: true,
            swap_id: body.swap_id,
            status: 'collection_instructions_ready',
            message: `Collection swap prepared. ${totalTransfers} NFT transfers required.`,
            collections: {
                offered: {
                    id: body.offered_collection.id,
                    count: body.offered_collection.nft_mints.length,
                    transfers: offeredTransfers
                },
                requested: {
                    id: body.requested_collection.id,
                    count: body.requested_collection.nft_mints.length,
                    transfers: requestedTransfers
                }
            },
            fees: {
                initiator_usdc: body.initiator_fee_usdc || 5.00,
                recipient_usdc: body.recipient_fee_usdc || 5.00,
                total_usdc: 10.00,
                estimated_gas_sol: 0.00005 * totalTransfers
            }
        });
        
    } catch (error: any) {
        console.error('[SWAP] Collection swap error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Collection swap failed'
        });
    }
});

/**
 * Verify swap completion
 * GET /api/swap/verify/:swap_id
 */
router.get('/verify/:swap_id', async (req: Request, res: Response) => {
    try {
        const { swap_id } = req.params;
        
        if (!swap_id) {
            return res.status(400).json({
                success: false,
                error: 'Swap ID required'
            });
        }
        
        console.log('[SWAP] Verify request:', swap_id);
        
        // In production, this would query the database and blockchain
        // For now, return pending status
        
        const result: SwapVerifyResult = {
            success: true,
            swap_id,
            status: 'pending'
        };
        
        return res.status(200).json(result);
        
    } catch (error: any) {
        console.error('[SWAP] Verify error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Verification failed'
        });
    }
});

/**
 * Get swap fee structure
 * GET /api/swap/fees
 */
router.get('/fees', (req: Request, res: Response) => {
    return res.status(200).json({
        success: true,
        fees: {
            fee_per_user_usdc: 5.00,
            total_swap_fee_usdc: 10.00,
            estimated_gas_sol: 0.00005,
            currency: 'USDC',
            notes: [
                'Each party pays 5 USDC',
                'Option for one party to pay full 10 USDC',
                'Solana gas fee paid by transaction signer',
                'Same fee for single NFT or collection swap'
            ]
        }
    });
});

/**
 * WordPress webhook for swap completion
 * POST /wc/webhooks/swap-completed
 */
router.post('/webhook/completed', (req: Request, res: Response) => {
    console.log('[SWAP WEBHOOK] Swap completed:', {
        swap_id: req.body?.swap_id,
        initiator_id: req.body?.initiator_id,
        recipient_id: req.body?.recipient_id,
        status: req.body?.status
    });
    
    return res.status(200).json({
        success: true,
        message: 'Swap completion webhook received'
    });
});

export default router;

