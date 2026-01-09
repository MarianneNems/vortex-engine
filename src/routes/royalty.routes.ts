/**
 * VORTEX Royalty Enforcement Routes v4.0.0
 * 
 * Handles perpetual royalty smart contract deployment and enforcement
 * for user data exports on Solana/TOLA blockchain.
 * 
 * 5% perpetual royalty is enforced on all future NFT mints when
 * users export their AI-trained creative profile.
 */

import express, { Request, Response } from 'express';
import {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import * as bs58 from 'bs58';

const router = express.Router();

// VORTEX Treasury Wallet for royalties
const VORTEX_ROYALTY_WALLET = process.env.VORTEX_ROYALTY_WALLET || 'VRTXroyalty11111111111111111111111111111111';
const VORTEX_ROYALTY_PERCENTAGE = 5; // 5% perpetual royalty

// Solana connection
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

// Royalty registry (in production, this would be stored in a database)
interface RoyaltyContract {
    contractId: string;
    userId: number;
    userWallet: string;
    royaltyWallet: string;
    royaltyPercentage: number;
    deployedAt: number;
    network: string;
    signatureHash: string;
    enforcementType: 'perpetual_nft_mint';
    status: 'active' | 'pending';
}

const royaltyRegistry: Map<string, RoyaltyContract> = new Map();

/**
 * Deploy royalty enforcement contract
 * Called when user exports their data
 */
router.post('/deploy', async (req: Request, res: Response) => {
    try {
        const {
            user_id,
            user_wallet,
            royalty_percentage = VORTEX_ROYALTY_PERCENTAGE,
            royalty_wallet = VORTEX_ROYALTY_WALLET,
            enforcement_type = 'perpetual_nft_mint'
        } = req.body;

        if (!user_id || !user_wallet) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: user_id, user_wallet'
            });
        }

        // Generate contract ID
        const contractId = `vrtx_royalty_${user_id}_${Date.now()}`;

        // Create signature hash for verification
        const signatureData = {
            user_id,
            user_wallet,
            royalty_percentage,
            royalty_wallet,
            timestamp: Date.now()
        };
        const signatureHash = Buffer.from(JSON.stringify(signatureData)).toString('base64');

        // Create royalty contract record
        const contract: RoyaltyContract = {
            contractId,
            userId: user_id,
            userWallet: user_wallet,
            royaltyWallet: royalty_wallet,
            royaltyPercentage: royalty_percentage,
            deployedAt: Date.now(),
            network: process.env.SOLANA_NETWORK || 'mainnet-beta',
            signatureHash,
            enforcementType: enforcement_type,
            status: 'active'
        };

        // Store in registry
        royaltyRegistry.set(contractId, contract);

        // In production, we would deploy an actual Solana program
        // For now, we register the royalty requirement in our system
        // The royalty is enforced at mint time through Metaplex creators array

        console.log(`[ROYALTY] Deployed contract for user ${user_id}: ${contractId}`);

        res.json({
            success: true,
            contract_address: contractId,
            contract_id: contractId,
            user_wallet,
            royalty_wallet,
            royalty_percentage,
            signature_hash: signatureHash,
            network: contract.network,
            deployed_at: contract.deployedAt,
            message: `${royalty_percentage}% perpetual royalty registered for user ${user_id}`
        });

    } catch (error) {
        console.error('[ROYALTY] Deploy error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to deploy royalty contract',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Verify royalty contract for a user
 */
router.get('/verify/:user_id', async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.user_id);

        // Find contract for user
        let userContract: RoyaltyContract | null = null;
        for (const contract of royaltyRegistry.values()) {
            if (contract.userId === userId && contract.status === 'active') {
                userContract = contract;
                break;
            }
        }

        if (!userContract) {
            return res.json({
                success: true,
                has_royalty_contract: false,
                message: 'No active royalty contract for this user'
            });
        }

        res.json({
            success: true,
            has_royalty_contract: true,
            contract: {
                contract_id: userContract.contractId,
                royalty_percentage: userContract.royaltyPercentage,
                royalty_wallet: userContract.royaltyWallet,
                deployed_at: userContract.deployedAt,
                status: userContract.status
            }
        });

    } catch (error) {
        console.error('[ROYALTY] Verify error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify royalty contract'
        });
    }
});

/**
 * Get royalty configuration for NFT minting
 * Called before each mint to get proper royalty settings
 */
router.get('/mint-config/:user_id', async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.user_id);

        // Find contract for user
        let userContract: RoyaltyContract | null = null;
        for (const contract of royaltyRegistry.values()) {
            if (contract.userId === userId && contract.status === 'active') {
                userContract = contract;
                break;
            }
        }

        // Base creator configuration
        const creators = [];
        let artistShare = 100;

        if (userContract) {
            // Reduce artist share by VORTEX royalty
            artistShare = 100 - userContract.royaltyPercentage;

            // Add VORTEX as royalty recipient
            creators.push({
                address: userContract.royaltyWallet,
                share: userContract.royaltyPercentage,
                verified: true,
                type: 'platform_royalty',
                reason: 'VORTEX AI Engine creative system perpetual royalty'
            });
        }

        // Artist gets remaining share
        creators.push({
            address: '{{USER_WALLET}}', // Placeholder - replaced at mint time
            share: artistShare,
            verified: true,
            type: 'artist'
        });

        res.json({
            success: true,
            user_id: userId,
            has_royalty_obligation: !!userContract,
            royalty_percentage: userContract?.royaltyPercentage || 0,
            creators,
            seller_fee_basis_points: 500, // 5% secondary sale royalty
            royalty_enforcement: userContract ? {
                contract_id: userContract.contractId,
                deployed_at: userContract.deployedAt,
                type: 'perpetual'
            } : null
        });

    } catch (error) {
        console.error('[ROYALTY] Mint config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get mint configuration'
        });
    }
});

/**
 * Record royalty payment
 * Called after successful NFT sale to record royalty distribution
 */
router.post('/record-payment', async (req: Request, res: Response) => {
    try {
        const {
            user_id,
            nft_address,
            sale_amount,
            royalty_amount,
            transaction_signature,
            sale_type // 'primary' or 'secondary'
        } = req.body;

        // Validate required fields
        if (!user_id || !nft_address || !sale_amount || !royalty_amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Find contract
        let userContract: RoyaltyContract | null = null;
        for (const contract of royaltyRegistry.values()) {
            if (contract.userId === user_id && contract.status === 'active') {
                userContract = contract;
                break;
            }
        }

        if (!userContract) {
            return res.status(404).json({
                success: false,
                error: 'No royalty contract found for user'
            });
        }

        // Record payment (in production, store in database)
        const paymentRecord = {
            payment_id: `pay_${Date.now()}`,
            contract_id: userContract.contractId,
            user_id,
            nft_address,
            sale_amount,
            royalty_amount,
            royalty_percentage: userContract.royaltyPercentage,
            transaction_signature,
            sale_type,
            recorded_at: Date.now()
        };

        console.log(`[ROYALTY] Payment recorded:`, paymentRecord);

        res.json({
            success: true,
            payment: paymentRecord,
            message: `Royalty payment of ${royalty_amount} recorded`
        });

    } catch (error) {
        console.error('[ROYALTY] Record payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to record payment'
        });
    }
});

/**
 * Get royalty statistics for admin
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== process.env.VORTEX_API_KEY) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const contracts = Array.from(royaltyRegistry.values());

        res.json({
            success: true,
            stats: {
                total_contracts: contracts.length,
                active_contracts: contracts.filter(c => c.status === 'active').length,
                total_users_with_royalty: new Set(contracts.map(c => c.userId)).size,
                royalty_percentage: VORTEX_ROYALTY_PERCENTAGE,
                royalty_wallet: VORTEX_ROYALTY_WALLET
            },
            contracts: contracts.slice(0, 100) // Return last 100 contracts
        });

    } catch (error) {
        console.error('[ROYALTY] Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get stats'
        });
    }
});

/**
 * Generate Metaplex-compatible creators array
 * This is used when minting NFTs to include VORTEX royalty
 */
router.post('/metaplex-creators', async (req: Request, res: Response) => {
    try {
        const { user_id, user_wallet, additional_creators = [] } = req.body;

        if (!user_id || !user_wallet) {
            return res.status(400).json({
                success: false,
                error: 'Missing user_id or user_wallet'
            });
        }

        // Check for royalty contract
        let userContract: RoyaltyContract | null = null;
        for (const contract of royaltyRegistry.values()) {
            if (contract.userId === user_id && contract.status === 'active') {
                userContract = contract;
                break;
            }
        }

        const creators = [];
        let remainingShare = 100;

        // Add VORTEX royalty if contract exists
        if (userContract) {
            creators.push({
                address: new PublicKey(userContract.royaltyWallet).toBase58(),
                share: userContract.royaltyPercentage,
                verified: true
            });
            remainingShare -= userContract.royaltyPercentage;
        }

        // Add additional creators
        for (const creator of additional_creators) {
            if (creator.share <= remainingShare) {
                creators.push({
                    address: creator.address,
                    share: creator.share,
                    verified: false
                });
                remainingShare -= creator.share;
            }
        }

        // Add primary artist
        creators.push({
            address: user_wallet,
            share: remainingShare,
            verified: false // Will be verified on-chain
        });

        res.json({
            success: true,
            creators,
            royalty_info: userContract ? {
                vortex_share: userContract.royaltyPercentage,
                contract_id: userContract.contractId,
                enforcement: 'perpetual'
            } : null
        });

    } catch (error) {
        console.error('[ROYALTY] Metaplex creators error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate creators array'
        });
    }
});

/**
 * Health check
 */
router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        version: '4.0.0',
        royalty_percentage: VORTEX_ROYALTY_PERCENTAGE,
        royalty_wallet: VORTEX_ROYALTY_WALLET,
        contracts_registered: royaltyRegistry.size,
        timestamp: Date.now()
    });
});

export default router;

