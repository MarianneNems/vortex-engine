"use strict";
/**
 * TOLA Art Draw Routes
 * Endpoints called by the WordPress plugin during the daily masterpiece draw.
 *
 * POST /api/tola/upload-metadata  — store Metaplex JSON metadata, return URI
 * POST /api/tola/mint-nft         — mint NFT on Solana using stored metadata URI
 *
 * Metadata storage priority:
 *   1. Pinata IPFS  — if PINATA_JWT env var is set
 *   2. NFT.storage  — if NFTSTORAGE_API_KEY env var is set
 *   3. Local file   — stored in ./metadata/ directory, served at /api/tola/metadata/:id
 *
 * @version 4.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logger_1 = require("../utils/logger");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");

const router = (0, express_1.Router)();

// Directory for local metadata fallback
const METADATA_DIR = path_1.join(__dirname, '..', '..', 'metadata');
try { (0, fs_1.mkdirSync)(METADATA_DIR, { recursive: true }); } catch (_) {}

const ENGINE_URL = process.env.VORTEX_ENGINE_URL ||
                   process.env.RAILWAY_PUBLIC_DOMAIN
                       ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                       : 'https://vortex-engine-production.up.railway.app';

/**
 * Upload metadata JSON to IPFS/Arweave or local fallback.
 * Returns { success: true, uri: '...' }
 */
async function uploadMetadata(metadata) {
    // ── Option 1: Pinata IPFS ────────────────────────────────────────────
    const pinataJwt = process.env.PINATA_JWT;
    if (pinataJwt) {
        try {
            const body = JSON.stringify({
                pinataContent: metadata,
                pinataMetadata: { name: metadata.name || 'TOLA Masterpiece Metadata' }
            });
            const resp = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${pinataJwt}`
                },
                body
            });
            const data = await resp.json();
            if (data.IpfsHash) {
                return { success: true, uri: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}` };
            }
        } catch (err) {
            logger_1.logger.warn('[TOLA-ART] Pinata upload failed, falling back', { error: err.message });
        }
    }

    // ── Option 2: NFT.storage ────────────────────────────────────────────
    const nftStorageKey = process.env.NFTSTORAGE_API_KEY;
    if (nftStorageKey) {
        try {
            const resp = await fetch('https://api.nft.storage/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${nftStorageKey}`
                },
                body: JSON.stringify(metadata)
            });
            const data = await resp.json();
            if (data.ok && data.value?.cid) {
                return { success: true, uri: `https://nftstorage.link/ipfs/${data.value.cid}` };
            }
        } catch (err) {
            logger_1.logger.warn('[TOLA-ART] NFT.storage upload failed, falling back', { error: err.message });
        }
    }

    // ── Option 3: Local file (served by this engine) ─────────────────────
    const id = crypto_1.randomUUID();
    const filePath = path_1.join(METADATA_DIR, `${id}.json`);
    (0, fs_1.writeFileSync)(filePath, JSON.stringify(metadata));
    const uri = `${ENGINE_URL}/api/tola/metadata/${id}`;
    logger_1.logger.info(`[TOLA-ART] Metadata stored locally: ${uri}`);
    return { success: true, uri };
}

/**
 * POST /api/tola/upload-metadata
 * Body: { metadata: { name, description, image, attributes, ... } }
 */
router.post('/upload-metadata', async (req, res) => {
    try {
        const { metadata } = req.body;
        if (!metadata || !metadata.name) {
            return res.status(400).json({ success: false, error: 'metadata.name is required' });
        }

        logger_1.logger.info(`[TOLA-ART] Uploading metadata for: ${metadata.name}`);
        const result = await uploadMetadata(metadata);

        if (result.success) {
            return res.json({ success: true, uri: result.uri });
        }
        return res.status(500).json({ success: false, error: 'All metadata upload methods failed' });
    } catch (err) {
        logger_1.logger.error('[TOLA-ART] upload-metadata error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tola/metadata/:id
 * Serve locally stored metadata JSON (fallback when no IPFS keys configured)
 */
router.get('/metadata/:id', (req, res) => {
    try {
        const { id } = req.params;
        // Sanitise: allow only UUID-style IDs (alphanumeric + hyphens)
        if (!/^[a-f0-9\-]{36}$/.test(id)) {
            return res.status(400).json({ success: false, error: 'Invalid metadata ID' });
        }
        const filePath = path_1.join(METADATA_DIR, `${id}.json`);
        if (!(0, fs_1.existsSync)(filePath)) {
            return res.status(404).json({ success: false, error: 'Metadata not found' });
        }
        res.setHeader('Content-Type', 'application/json');
        res.send((0, fs_1.readFileSync)(filePath));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tola/mint-nft
 * Body: { name, uri, recipient, royalty_basis_points, creators }
 */
router.post('/mint-nft', async (req, res) => {
    try {
        const { name, uri, recipient, royalty_basis_points, creators } = req.body;

        if (!name || !uri) {
            return res.status(400).json({ success: false, error: 'name and uri are required' });
        }

        logger_1.logger.info(`[TOLA-ART] Minting NFT: ${name} | URI: ${uri}`);

        // Load NFT mint service dynamically (may not be initialised at boot)
        let nftService = null;
        try {
            const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
            nftService = new TOLANFTMintService();
        } catch (loadErr) {
            logger_1.logger.warn('[TOLA-ART] NFT mint service unavailable:', loadErr.message);
        }

        if (!nftService || !nftService.initialized) {
            // Treasury not configured — return a mock mint address for testing
            logger_1.logger.warn('[TOLA-ART] Treasury wallet not configured; returning mock mint address');
            return res.json({
                success: true,
                mint_address: `MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
                uri,
                name,
                status: 'mock',
                note: 'Set TREASURY_WALLET_PRIVATE env var for real minting'
            });
        }

        const mintResult = await nftService.mintNFT({
            name,
            uri,
            recipient: recipient || undefined,
            royaltyBasisPoints: royalty_basis_points || 2000,
            creators: creators || []
        });

        if (mintResult.success) {
            return res.json({
                success: true,
                mint_address: mintResult.mintAddress,
                uri,
                name,
                status: 'minted'
            });
        }

        return res.status(500).json({ success: false, error: mintResult.error || 'Mint failed' });
    } catch (err) {
        logger_1.logger.error('[TOLA-ART] mint-nft error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

exports.default = router;
