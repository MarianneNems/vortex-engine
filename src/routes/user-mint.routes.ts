/**
 * Canonical user-mint pathway (Founder directive 2026-08-31).
 *
 * The ONLY route family WordPress calls to mint on a member's behalf. The browser
 * never reaches these routes: every request must carry a fresh WordPress HMAC
 * (fail-closed - see wp-hmac.middleware), and the response returns on-chain
 * certification fields for WordPress to persist after its own reconciliation.
 *
 *   POST /api/mint/prepare  - validate, derive the deterministic mint, simulate. No writes.
 *   POST /api/mint/execute  - execute or resume the mint. dry_run defaults TRUE;
 *                             only an explicit dry_run:false submits.
 *   POST /api/mint/status   - chain-truth state for an idempotency key.
 */

import { Router, Request, Response } from 'express';
import { requireWpHmac } from '../middleware/wp-hmac.middleware';
import { logger } from '../utils/logger';

const router = Router();

let nftService: any = null;
function service() {
    if (!nftService) {
        const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
        nftService = new TOLANFTMintService();
    }
    return nftService;
}

router.post('/prepare', requireWpHmac, async (req: Request, res: Response) => {
    try {
        const result = await service().userMint({ ...req.body, dry_run: true });
        return res.status(result.success ? 200 : 422).json(result);
    } catch (e: any) {
        logger.error('[USER MINT] prepare error', { error: e.message });
        return res.status(500).json({ success: false, code: 'PREPARE_FAILED', error: e.message });
    }
});

router.post('/execute', requireWpHmac, async (req: Request, res: Response) => {
    try {
        // dry_run stays true unless the caller writes dry_run:false explicitly.
        const dryRun = req.body?.dry_run !== false;
        const result = await service().userMint({ ...req.body, dry_run: dryRun });
        return res.status(result.success ? 200 : 422).json(result);
    } catch (e: any) {
        logger.error('[USER MINT] execute error', { error: e.message });
        return res.status(500).json({ success: false, code: 'EXECUTE_FAILED', error: e.message });
    }
});

router.post('/status', requireWpHmac, async (req: Request, res: Response) => {
    try {
        const key = String(req.body?.idempotency_key || '');
        const result = await service().userMintStatus(key);
        return res.status(result.success ? 200 : 422).json(result);
    } catch (e: any) {
        return res.status(500).json({ success: false, code: 'STATUS_FAILED', error: e.message });
    }
});

export default router;
