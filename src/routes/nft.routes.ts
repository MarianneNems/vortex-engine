/**
 * NFT Routes - Production Grade
 * Complete NFT management endpoints for minting, transfers, and queries
 * 
 * Endpoints:
 * - POST /api/nft/mint - Mint new NFT
 * - POST /api/nft/transfer - Transfer NFT
 * - GET /api/nft/:mint_address - Get NFT details
 * - GET /api/nft/owner/:wallet - Get NFTs owned by wallet
 * - GET /api/nft/collection/:address - Get collection NFTs
 * - POST /api/nft/metadata/upload - Upload metadata to IPFS/Arweave
 * - GET /api/nft/stats - Get minting statistics
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { TOLANFTMintService, NFTMintRequest } from '../services/tola-nft-mint.service';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

// Initialize service
let nftService: TOLANFTMintService | null = null;
try {
    nftService = new TOLANFTMintService();
    logger.info('[NFT Routes] Service initialized');
} catch (error: any) {
    logger.error('[NFT Routes] Service initialization failed:', error.message);
}

// Validation helpers
const validateWalletAddress = (address: string): boolean => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

const validateMintAddress = (address: string): boolean => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

const validateURI = (uri: string): boolean => {
    try {
        new URL(uri);
        return true;
    } catch {
        return uri.startsWith('ipfs://') || uri.startsWith('ar://');
    }
};

/**
 * POST /api/nft/mint
 * Mint a new NFT with metadata
 */
router.post('/mint', authMiddleware, async (req: Request, res: Response) => {
    try {
        if (!nftService) {
            return res.status(503).json({
                success: false,
                error: 'NFT service not available',
                code: 'SERVICE_UNAVAILABLE'
            });
        }

        const {
            name,
            symbol,
            uri,
            description,
            image,
            seller_fee_basis_points,
            creators,
            collection,
            attributes,
            recipient,
            is_mutable
        } = req.body;

        // Validation
        const errors: string[] = [];
        
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            errors.push('name is required and must be a non-empty string');
        }
        if (name && name.length > 32) {
            errors.push('name must be 32 characters or less');
        }
        
        if (!uri || typeof uri !== 'string') {
            errors.push('uri is required');
        } else if (!validateURI(uri)) {
            errors.push('uri must be a valid URL, IPFS, or Arweave URI');
        }
        
        if (symbol && symbol.length > 10) {
            errors.push('symbol must be 10 characters or less');
        }
        
        if (seller_fee_basis_points !== undefined) {
            if (typeof seller_fee_basis_points !== 'number' || 
                seller_fee_basis_points < 0 || 
                seller_fee_basis_points > 10000) {
                errors.push('seller_fee_basis_points must be between 0 and 10000');
            }
        }
        
        if (recipient && !validateWalletAddress(recipient)) {
            errors.push('recipient must be a valid Solana wallet address');
        }
        
        if (creators && Array.isArray(creators)) {
            let totalShare = 0;
            for (const creator of creators) {
                if (!creator.address || !validateWalletAddress(creator.address)) {
                    errors.push('each creator must have a valid address');
                }
                if (typeof creator.share !== 'number' || creator.share < 0 || creator.share > 100) {
                    errors.push('each creator share must be between 0 and 100');
                }
                totalShare += creator.share || 0;
            }
            if (totalShare !== 100) {
                errors.push('creator shares must sum to 100');
            }
        }
        
        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors,
                code: 'VALIDATION_ERROR'
            });
        }

        logger.info(`[NFT] Minting request: ${name}`);

        const mintRequest: NFTMintRequest = {
            name: name.trim(),
            symbol: symbol?.trim() || 'VORTEX',
            uri,
            description,
            image,
            seller_fee_basis_points: seller_fee_basis_points || 500,
            creators,
            collection,
            attributes,
            recipient,
            is_mutable: is_mutable !== false
        };

        const result = await nftService.mintNFT(mintRequest);

        if (result.success) {
            logger.info(`[NFT] Minted successfully: ${result.mint_address}`);
            return res.status(201).json({
                success: true,
                data: {
                    mint_address: result.mint_address,
                    metadata_address: result.metadata_address,
                    token_account: result.token_account,
                    signature: result.signature,
                    explorer_url: result.explorer_url,
                    fee_sol: result.fee
                },
                message: 'NFT minted successfully',
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        } else {
            return res.status(500).json({
                success: false,
                error: result.error,
                code: 'MINT_FAILED'
            });
        }

    } catch (error: any) {
        logger.error('[NFT] Mint error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * POST /api/nft/transfer
 * Transfer an NFT to another wallet
 */
router.post('/transfer', authMiddleware, async (req: Request, res: Response) => {
    try {
        if (!nftService) {
            return res.status(503).json({
                success: false,
                error: 'NFT service not available',
                code: 'SERVICE_UNAVAILABLE'
            });
        }

        const { mint_address, recipient_wallet, memo } = req.body;

        // Validation
        if (!mint_address || !validateMintAddress(mint_address)) {
            return res.status(400).json({
                success: false,
                error: 'Valid mint_address is required',
                code: 'INVALID_MINT_ADDRESS'
            });
        }

        if (!recipient_wallet || !validateWalletAddress(recipient_wallet)) {
            return res.status(400).json({
                success: false,
                error: 'Valid recipient_wallet is required',
                code: 'INVALID_RECIPIENT'
            });
        }

        logger.info(`[NFT] Transfer request: ${mint_address} -> ${recipient_wallet}`);

        const result = await nftService.transferNFT({
            mint_address,
            recipient_wallet
        });

        if (result.success) {
            logger.info(`[NFT] Transferred successfully: ${result.signature}`);
            return res.json({
                success: true,
                data: {
                    mint_address,
                    recipient: recipient_wallet,
                    signature: result.signature,
                    explorer_url: result.explorer_url
                },
                message: 'NFT transferred successfully',
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        } else {
            return res.status(500).json({
                success: false,
                error: result.error,
                code: 'TRANSFER_FAILED'
            });
        }

    } catch (error: any) {
        logger.error('[NFT] Transfer error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/nft/:mint_address
 * Get NFT details by mint address
 */
router.get('/:mint_address', optionalAuthMiddleware, async (req: Request, res: Response) => {
    try {
        if (!nftService) {
            return res.status(503).json({
                success: false,
                error: 'NFT service not available'
            });
        }

        const { mint_address } = req.params;

        if (!validateMintAddress(mint_address)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid mint address format',
                code: 'INVALID_MINT_ADDRESS'
            });
        }

        const result = await nftService.getNFT(mint_address);

        if (result.success) {
            return res.json({
                success: true,
                data: {
                    mint_address: result.mint_address,
                    name: result.name,
                    symbol: result.symbol,
                    uri: result.uri,
                    description: result.description,
                    image: result.image,
                    owner: result.owner,
                    creators: result.creators,
                    seller_fee_basis_points: result.seller_fee_basis_points,
                    attributes: result.attributes,
                    collection: result.collection,
                    explorer_url: `https://solscan.io/token/${mint_address}`
                },
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        } else {
            return res.status(404).json({
                success: false,
                error: result.error || 'NFT not found',
                code: 'NOT_FOUND'
            });
        }

    } catch (error: any) {
        logger.error('[NFT] Get error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nft/minted/recent
 * Get recently minted NFTs
 */
router.get('/minted/recent', async (req: Request, res: Response) => {
    try {
        if (!nftService) {
            return res.status(503).json({
                success: false,
                error: 'NFT service not available'
            });
        }

        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const nfts = nftService.getMintedNFTs(limit);

        return res.json({
            success: true,
            data: {
                nfts: nfts.map(n => ({
                    mint_address: n.mint_address,
                    name: n.name,
                    uri: n.uri,
                    owner: n.owner,
                    created_at: n.created_at,
                    signature: n.signature,
                    explorer_url: `https://solscan.io/token/${n.mint_address}`
                })),
                count: nfts.length
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        logger.error('[NFT] Get recent error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nft/stats
 * Get NFT minting statistics
 */
router.get('/stats/overview', async (req: Request, res: Response) => {
    try {
        if (!nftService) {
            return res.status(503).json({
                success: false,
                error: 'NFT service not available'
            });
        }

        const stats = nftService.getStats();
        const health = await nftService.getHealth();

        return res.json({
            success: true,
            data: {
                total_minted: stats.total_minted,
                minted_last_hour: stats.recent_mints,
                service_healthy: health.healthy,
                treasury_configured: health.treasury_configured,
                treasury_sol_balance: health.treasury_sol_balance,
                rpc_connections: health.rpc_connections
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        logger.error('[NFT] Stats error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/nft/batch/mint
 * Batch mint multiple NFTs
 */
router.post('/batch/mint', authMiddleware, async (req: Request, res: Response) => {
    try {
        if (!nftService) {
            return res.status(503).json({
                success: false,
                error: 'NFT service not available'
            });
        }

        const { nfts } = req.body;

        if (!Array.isArray(nfts) || nfts.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'nfts array is required',
                code: 'INVALID_INPUT'
            });
        }

        if (nfts.length > 10) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 10 NFTs per batch',
                code: 'BATCH_TOO_LARGE'
            });
        }

        logger.info(`[NFT] Batch mint request: ${nfts.length} NFTs`);

        const results = [];
        let successful = 0;

        for (const nftData of nfts) {
            try {
                const result = await nftService.mintNFT(nftData);
                results.push({
                    name: nftData.name,
                    ...result
                });
                if (result.success) successful++;
                
                // Small delay between mints to avoid rate limits
                await new Promise(r => setTimeout(r, 500));
            } catch (e: any) {
                results.push({
                    name: nftData.name,
                    success: false,
                    error: e.message
                });
            }
        }

        return res.status(successful > 0 ? 201 : 500).json({
            success: successful > 0,
            data: {
                total: nfts.length,
                successful,
                failed: nfts.length - successful,
                results
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        logger.error('[NFT] Batch mint error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nft/verify/:signature
 * Verify an NFT minting transaction
 */
router.get('/verify/:signature', async (req: Request, res: Response) => {
    try {
        const { signature } = req.params;

        if (!signature || signature.length < 80) {
            return res.status(400).json({
                success: false,
                error: 'Invalid transaction signature'
            });
        }

        // Check if this is a known minted NFT
        const mintedNFTs = nftService?.getMintedNFTs(1000) || [];
        const knownMint = mintedNFTs.find(n => n.signature === signature);

        return res.json({
            success: true,
            data: {
                signature,
                verified: !!knownMint,
                mint_address: knownMint?.mint_address,
                name: knownMint?.name,
                owner: knownMint?.owner,
                created_at: knownMint?.created_at,
                explorer_url: `https://solscan.io/tx/${signature}`
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        logger.error('[NFT] Verify error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
export { router as nftRoutes };
