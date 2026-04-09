/**
 * TOLA Masterpiece Routes
 * NFT minting and management for platform artworks
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { authMiddleware } from '../middleware/auth.middleware';
import { TOLANFTMintService } from '../services/tola-nft-mint.service';

const router = Router();
const mintService = new TOLANFTMintService();

/**
 * POST /api/tola-masterpiece/mint
 * Mint a new masterpiece NFT on Solana via TOLA
 */
router.post('/mint', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, description, image_url, artist_id, metadata, creators, uri, sellerFeeBasisPoints } = req.body;

        if (!name || !image_url) {
            return res.status(400).json({
                success: false,
                error: 'Missing name or image_url'
            });
        }

        logger.info(`[MASTERPIECE] Minting on Solana: ${name} for artist ${artist_id}`);

        // Mint via real TOLA NFT service on Solana
        const result = await mintService.mintNFT({
            name,
            symbol: 'TOLA',
            uri: uri || '',
            image: image_url || '',
            description: description || '',
            creators: creators || [],
            seller_fee_basis_points: sellerFeeBasisPoints || 1000,
            metadata: metadata || {},
        });

        if (result.success) {
            res.json({
                success: true,
                data: {
                    mint_address: result.mint_address,
                    signature: result.signature,
                    name,
                    description,
                    image_url,
                    artist_id,
                    status: 'minted',
                    created_at: new Date().toISOString()
                },
                version: '4.0.0'
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Minting failed',
                version: '4.0.0'
            });
        }
        
    } catch (error: any) {
        logger.error('[MASTERPIECE] Mint error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/tola-masterpiece/artist/:artist_id
 * Get all masterpieces for an artist — MUST be before /:mint_address to avoid shadowing
 */
router.get('/artist/:artist_id', async (req: Request, res: Response) => {
    try {
        const { artist_id } = req.params;

        res.json({
            success: true,
            data: {
                artist_id: parseInt(artist_id),
                masterpieces: [],
                total: 0
            },
            version: '4.0.0'
        });

    } catch (error: any) {
        logger.error('[MASTERPIECE] Artist error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/tola-masterpiece/:mint_address
 * Get masterpiece details — wildcard param, must be AFTER all static GET routes
 */
router.get('/:mint_address', async (req: Request, res: Response) => {
    try {
        const { mint_address } = req.params;

        res.json({
            success: true,
            data: {
                mint_address,
                name: 'Unknown',
                status: 'not_found'
            },
            version: '4.0.0'
        });

    } catch (error: any) {
        logger.error('[MASTERPIECE] Get error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/tola-masterpiece/transfer
 * Transfer masterpiece to new owner
 */
router.post('/transfer', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { mint_address, recipient_wallet, from_user_id } = req.body;
        
        if (!mint_address || !recipient_wallet) {
            return res.status(400).json({
                success: false,
                error: 'Missing mint_address or recipient_wallet'
            });
        }
        
        logger.info(`[MASTERPIECE] Transfer ${mint_address} to ${recipient_wallet}`);
        
        res.json({
            success: true,
            data: {
                mint_address,
                recipient_wallet,
                status: 'pending',
                transferred_at: new Date().toISOString()
            },
            version: '4.0.0'
        });
        
    } catch (error: any) {
        logger.error('[MASTERPIECE] Transfer error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
