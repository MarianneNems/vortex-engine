/**
 * TOLA Compat Routes - Backward-compatibility layer for PHP callers
 *
 * Mounts at /api/tola and provides the 5 endpoints that WordPress PHP
 * callers invoke via call_engine().  All responses are returned FLAT
 * (not wrapped in a `data` key) so that PHP can check fields like
 * `$response['mint_address']` directly.
 *
 * NOTE: TOLA is an INCENTIVE/REWARD token only — never used for purchases.
 *
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { TOLANFTMintService, NFTMintRequest } from '../services/tola-nft-mint.service';
import { TOLATransferService, TOLATransferRequest } from '../services/tola-transfer.service';
import { authMiddleware, adminAuthMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();

// ---------------------------------------------------------------------------
// Service initialization
// ---------------------------------------------------------------------------

let nftMintService: TOLANFTMintService | null = null;
let transferService: TOLATransferService | null = null;

try {
    nftMintService = new TOLANFTMintService();
    logger.info('[TOLA COMPAT] TOLANFTMintService initialized');
} catch (error: any) {
    logger.error('[TOLA COMPAT] TOLANFTMintService failed to initialize:', error.message);
}

try {
    transferService = new TOLATransferService();
    logger.info('[TOLA COMPAT] TOLATransferService initialized');
} catch (error: any) {
    logger.error('[TOLA COMPAT] TOLATransferService failed to initialize:', error.message);
}

// ---------------------------------------------------------------------------
// POST /api/tola/upload-metadata
//
// PHP sends: { metadata: { name, description, image, attributes, ... } }
// PHP reads: $response['uri']  — a permanent ipfs:// URI for the metadata JSON.
//
// Storage priority:
//   1. Pinata IPFS  — PINATA_JWT env var
//   2. NFT.storage  — NFTSTORAGE_API_KEY env var
//   3. (none) — there is deliberately NO third option. This used to fall back to a file on
//      this Railway instance, which made a missing key look like a successful upload.
//      Permanent storage is now required and the call fails closed without it.
// ---------------------------------------------------------------------------

const METADATA_DIR = join(__dirname, '..', '..', 'metadata');
try { mkdirSync(METADATA_DIR, { recursive: true }); } catch (_) {}

const ENGINE_URL = process.env.VORTEX_ENGINE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://vortex-engine-production.up.railway.app');

async function storeMetadata(metadata: Record<string, unknown>): Promise<{ success: boolean; uri?: string; cid?: string; error?: string }> {
    // Option 1: Pinata
    const pinataJwt = process.env.PINATA_JWT;
    if (pinataJwt) {
        try {
            const resp = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pinataJwt}` },
                body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: String(metadata.name || 'TOLA Masterpiece') } })
            });
            const data: any = await resp.json();
            // Store the canonical ipfs:// CID, not the gateway URL. A gateway host can be retired
            // or blocked; the CID is the content itself and stays resolvable through any gateway.
            if (data.IpfsHash) return { success: true, uri: `ipfs://${data.IpfsHash}`, cid: data.IpfsHash };
        } catch (err: any) { logger.warn('[TOLA COMPAT] Pinata upload failed:', err.message); }
    }
    // Option 2: NFT.storage
    const nftKey = process.env.NFTSTORAGE_API_KEY;
    if (nftKey) {
        try {
            const resp = await fetch('https://api.nft.storage/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nftKey}` },
                body: JSON.stringify(metadata)
            });
            const data: any = await resp.json();
            if (data.ok && data.value?.cid) return { success: true, uri: `ipfs://${data.value.cid}`, cid: data.value.cid };
        } catch (err: any) { logger.warn('[TOLA COMPAT] NFT.storage upload failed:', err.message); }
    }
    // NO local fallback. This used to write a file served from this Railway instance and return
    // success, so a missing PINATA_JWT produced an ephemeral URI while reporting that permanent
    // storage had worked. All 138 TOLA metadata URIs ended up on that path and some already 404.
    //
    // An NFT whose metadata can disappear is not an NFT, so this now fails closed.
    logger.error('[TOLA COMPAT] Permanent storage unavailable - refusing to return a mutable URI');
    return {
        success: false,
        error: 'permanent_storage_unavailable: configure PINATA_JWT or NFTSTORAGE_API_KEY. ' +
               'Railway-local and WordPress URLs are not acceptable for NFT metadata.',
    };
}

/**
 * Fetch an object back from storage and hash it, to prove it is really retrievable.
 *
 * Upload success is the provider's claim about itself. This is the independent read: it fetches
 * through the gateway a wallet would use, and returns the SHA-256 of what actually came back, so
 * the caller can compare it against the bytes it meant to store.
 */
async function retrieveAndHash(uri: string): Promise<{ ok: boolean; sha256?: string; bytes?: number; error?: string }> {
    try {
        const resp = await fetch(uri, { redirect: 'follow' });
        if (!resp.ok) { return { ok: false, error: `http_${resp.status}` }; }
        const buf = Buffer.from(await resp.arrayBuffer());
        return { ok: true, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
    } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
    }
}

router.post('/upload-metadata', async (req: Request, res: Response) => {
    try {
        const { metadata } = req.body;
        if (!metadata || !metadata.name) {
            return res.status(400).json({ success: false, error: 'metadata.name is required' });
        }
        logger.info(`[TOLA COMPAT] upload-metadata: ${metadata.name}`);
        const result = await storeMetadata(metadata);
        return res.json(result);
    } catch (err: any) {
        logger.error('[TOLA COMPAT] upload-metadata error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/tola/metadata/:id  — serve locally stored metadata JSON
router.get('/metadata/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const filePath = join(METADATA_DIR, `${id}.json`);
    if (!existsSync(filePath)) return res.status(404).json({ success: false, error: 'Not found' });
    res.setHeader('Content-Type', 'application/json');
    res.send(readFileSync(filePath));
});

// ---------------------------------------------------------------------------
// POST /api/tola/upgrade-mint    (FOUNDER RULING - repair of existing bare mints)
//
// Narrow by construction: this endpoint can only attach metadata and a Master Edition to an
// EXISTING supply-one zero-decimal mint whose authority we hold. It cannot mint supply, cannot
// create a new mint, and refuses anything already carrying metadata. Admin-gated.
//
// Two-step: the default is a dry run returning a full preview (instructions, serialized message,
// message hash, approval hash, costs, authorities). Execution requires dry_run:false AND
// approved_hash equal to the preview's approval_sha256 - the Founder signing boundary.
// ---------------------------------------------------------------------------
router.post('/upgrade-mint', adminAuthMiddleware, async (req: Request, res: Response) => {
    if (!nftMintService) {
        return res.status(503).json({ success: false, error: 'NFT mint service not available' });
    }
    const b = req.body || {};
    for (const k of ['mint', 'name', 'uri', 'expected_owner']) {
        if (!b[k] || typeof b[k] !== 'string') {
            return res.status(400).json({ success: false, error: `missing required field: ${k}` });
        }
    }
    try {
        const result = await nftMintService.upgradeExistingMint({
            mint: b.mint,
            name: b.name,
            uri: b.uri,
            creator: typeof b.creator === 'string' ? b.creator : undefined,
            collectionMint: typeof b.collection_mint === 'string' ? b.collection_mint : undefined,
            expectedOwner: b.expected_owner,
            sellerFeeBasisPoints: typeof b.seller_fee_basis_points === 'number' ? b.seller_fee_basis_points : undefined,
            // Anything other than the explicit literal false is a dry run. Fail-closed.
            dryRun: b.dry_run !== false,
            approvedHash: typeof b.approved_hash === 'string' ? b.approved_hash : undefined,
        });
        return res.status(result.success || result.refused === 'dry_run_only' ? 200 : 422).json(result);
    } catch (e: any) {
        logger.error('[TOLA COMPAT] upgrade-mint error', { error: e?.message });
        return res.status(500).json({ success: false, error: e?.message || 'internal error' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tola/create-collection   (FOUNDER manifest v2 - the ONE governed new mint)
// Seed-derived address, refuses if it exists, dry-run default, approval-hash bound.
// ---------------------------------------------------------------------------
router.post('/create-collection', adminAuthMiddleware, async (req: Request, res: Response) => {
    if (!nftMintService) { return res.status(503).json({ success: false, error: 'service unavailable' }); }
    const b = req.body || {};
    for (const k of ['name', 'uri']) {
        if (!b[k] || typeof b[k] !== 'string') { return res.status(400).json({ success: false, error: `missing: ${k}` }); }
    }
    try {
        const result = await nftMintService.createCollectionNft({
            name: b.name, uri: b.uri,
            creator: typeof b.creator === 'string' ? b.creator : undefined,
            sellerFeeBasisPoints: typeof b.seller_fee_basis_points === 'number' ? b.seller_fee_basis_points : undefined,
            dryRun: b.dry_run !== false,
            approvedHash: typeof b.approved_hash === 'string' ? b.approved_hash : undefined,
            // 'tola' (the daily line, already created) or 'creator' (member works).
            lane: typeof b.lane === 'string' ? b.lane : undefined,
            symbol: typeof b.symbol === 'string' ? b.symbol : undefined,
        });
        return res.status(result.success || result.refused === 'dry_run_only' ? 200 : 422).json(result);
    } catch (e: any) {
        return res.status(500).json({ success: false, error: e?.message || 'internal error' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tola/verify-collection-item   (SetAndVerifySizedCollectionItem, one item)
// ---------------------------------------------------------------------------
router.post('/verify-collection-item', adminAuthMiddleware, async (req: Request, res: Response) => {
    if (!nftMintService) { return res.status(503).json({ success: false, error: 'service unavailable' }); }
    const b = req.body || {};
    if (!b.mint || typeof b.mint !== 'string') { return res.status(400).json({ success: false, error: 'missing: mint' }); }
    try {
        const result = await nftMintService.setAndVerifyCollectionItem({
            mint: b.mint,
            dryRun: b.dry_run !== false,
            approvedHash: typeof b.approved_hash === 'string' ? b.approved_hash : undefined,
        });
        return res.status(result.success || result.refused === 'dry_run_only' ? 200 : 422).json(result);
    } catch (e: any) {
        return res.status(500).json({ success: false, error: e?.message || 'internal error' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tola/mint-nft
//
// PHP sends: { name, symbol, uri, recipient_wallet, seller_fee_basis_points, creators }
// PHP reads: $response['mint_address']  — flat response required.
// ---------------------------------------------------------------------------
router.post('/mint-nft', authMiddleware, async (req: Request, res: Response) => {
    if (!nftMintService) {
        logger.error('[TOLA COMPAT] mint-nft called but TOLANFTMintService is unavailable');
        return res.status(503).json({
            success: false,
            error: 'NFT mint service not available'
        });
    }

    const {
        name,
        symbol,
        uri,
        recipient_wallet,
        seller_fee_basis_points,
        creators
    } = req.body;

    if (!name || !uri) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: name, uri'
        });
    }

    // PHP uses recipient_wallet; service uses recipient
    const mintRequest: NFTMintRequest = {
        name,
        symbol,
        uri,
        recipient: recipient_wallet,
        seller_fee_basis_points,
        creators
    };

    logger.info(`[TOLA COMPAT] mint-nft → name=${name} recipient=${recipient_wallet}`);

    try {
        const result = await nftMintService.mintNFT(mintRequest);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Mint failed'
            });
        }

        // Flat response — PHP checks $response['mint_address'] directly
        return res.json({
            success: true,
            mint_address: result.mint_address,
            tx_signature: result.signature,
            metadata_address: result.metadata_address
        });
    } catch (error: any) {
        logger.error('[TOLA COMPAT] mint-nft error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal error during NFT mint'
        });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tola/transfer-nft
//
// PHP sends: { mint_address, recipient_wallet }
// ---------------------------------------------------------------------------
router.post('/transfer-nft', authMiddleware, async (req: Request, res: Response) => {
    if (!nftMintService) {
        logger.error('[TOLA COMPAT] transfer-nft called but TOLANFTMintService is unavailable');
        return res.status(503).json({
            success: false,
            error: 'NFT mint service not available'
        });
    }

    const { mint_address, recipient_wallet } = req.body;

    if (!mint_address || !recipient_wallet) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: mint_address, recipient_wallet'
        });
    }

    logger.info(`[TOLA COMPAT] transfer-nft → mint=${mint_address} recipient=${recipient_wallet}`);

    try {
        const result = await nftMintService.transferNFT({ mint_address, recipient_wallet });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'NFT transfer failed'
            });
        }

        return res.json({
            success: true,
            signature: result.signature,
            explorer_url: result.explorer_url
        });
    } catch (error: any) {
        logger.error('[TOLA COMPAT] transfer-nft error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal error during NFT transfer'
        });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tola/nft/:mint_address
// ---------------------------------------------------------------------------
router.get('/nft/:mint_address', authMiddleware, async (req: Request, res: Response) => {
    if (!nftMintService) {
        logger.error('[TOLA COMPAT] nft lookup called but TOLANFTMintService is unavailable');
        return res.status(503).json({
            success: false,
            error: 'NFT mint service not available'
        });
    }

    const { mint_address } = req.params;

    if (!mint_address) {
        return res.status(400).json({
            success: false,
            error: 'Missing mint_address parameter'
        });
    }

    logger.info(`[TOLA COMPAT] nft lookup → mint=${mint_address}`);

    try {
        const result = await nftMintService.getNFT(mint_address);

        if (!result.success) {
            return res.status(404).json({
                success: false,
                error: result.error || 'NFT not found'
            });
        }

        // Flat NFT data
        return res.json(result);
    } catch (error: any) {
        logger.error('[TOLA COMPAT] nft lookup error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal error fetching NFT'
        });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tola/transfer
//
// PHP sends: { user_id, wallet_address, amount_tola }
// TOLA is an INCENTIVE/REWARD token — not for purchases.
// ---------------------------------------------------------------------------
router.post('/transfer', authMiddleware, async (req: Request, res: Response) => {
    if (!transferService) {
        logger.error('[TOLA COMPAT] transfer called but TOLATransferService is unavailable');
        return res.status(503).json({
            success: false,
            error: 'TOLA transfer service not available'
        });
    }

    const { user_id, wallet_address, amount_tola } = req.body;

    if (!user_id || !wallet_address || amount_tola === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: user_id, wallet_address, amount_tola'
        });
    }

    const transferRequest: TOLATransferRequest = {
        user_id: Number(user_id),
        wallet_address,
        amount_tola: Number(amount_tola),
        reason: 'incentive'
    };

    logger.info(`[TOLA COMPAT] transfer → user=${user_id} wallet=${wallet_address} amount=${amount_tola} TOLA`);

    try {
        const result = await transferService.transferTOLA(transferRequest);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'TOLA transfer failed'
            });
        }

        return res.json({
            success: true,
            signature: result.signature,
            amount: result.amount,
            recipient: result.recipient,
            explorer_url: result.explorer_url
        });
    } catch (error: any) {
        logger.error('[TOLA COMPAT] transfer error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal error during TOLA transfer'
        });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tola/balance/:wallet
// ---------------------------------------------------------------------------
router.get('/balance/:wallet', authMiddleware, async (req: Request, res: Response) => {
    if (!transferService) {
        logger.error('[TOLA COMPAT] balance called but TOLATransferService is unavailable');
        return res.status(503).json({
            success: false,
            error: 'TOLA transfer service not available'
        });
    }

    const { wallet } = req.params;

    if (!wallet) {
        return res.status(400).json({
            success: false,
            error: 'Missing wallet parameter'
        });
    }

    logger.info(`[TOLA COMPAT] balance → wallet=${wallet}`);

    try {
        const balance = await transferService.getBalance(wallet);

        return res.json({
            success: true,
            wallet,
            balance,
            symbol: 'TOLA'
        });
    } catch (error: any) {
        logger.error('[TOLA COMPAT] balance error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal error fetching TOLA balance'
        });
    }
});

export { router as tolaCompatRoutes };
