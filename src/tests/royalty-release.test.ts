/**
 * Royalty Release Tests (FOUNDER RULING - CANARY 50, item 8)
 *
 * The governed royalty is 500 bps - 5%, founder-ratified. These tests FAIL THE RELEASE if any
 * code path can supply a different value:
 *   1. The locked constant itself is 500.
 *   2. upgradeExistingMint refuses a caller-supplied 2000 (the historical defect value).
 *   3. upgradeExistingMint refuses ANY non-500 value, not just 2000.
 *   4. No source file under src/ carries a competing *_ROYALTY constant that is not 500.
 *
 * Run:  npx ts-node src/tests/royalty-release.test.ts
 */

import assert from 'assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

async function testLockedConstant(): Promise<void> {
    const src = readFileSync(join(__dirname, '../services/tola-nft-mint.service.ts'), 'utf8');
    const m = src.match(/BPS:\s*(\d+)/);
    assert(m, 'IMMUTABLE_ROYALTY.BPS not found');
    assert.strictEqual(Number(m[1]), 500, `IMMUTABLE_ROYALTY.BPS is ${m[1]}, must be 500`);
    console.log('  PASS locked constant is 500 bps');
}

async function testUpgradeRefusesTwoThousand(): Promise<void> {
    const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
    const svc = new TOLANFTMintService();
    // Request validation runs before the signer check by design, so no key is needed here.
    const r = await svc.upgradeExistingMint({
        mint: '11111111111111111111111111111111',
        name: 'x', uri: 'ipfs://QmTest', expectedOwner: 'x',
        sellerFeeBasisPoints: 2000, dryRun: true,
    });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.refused, 'royalty_mismatch', `expected royalty_mismatch, got ${r.refused}`);
    console.log('  PASS 2000 bps refused');
}

async function testUpgradeRefusesAnyOtherValue(): Promise<void> {
    const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
    const svc = new TOLANFTMintService();
    for (const bad of [0, 1, 499, 501, 1000, 10000]) {
        const r = await svc.upgradeExistingMint({
            mint: '11111111111111111111111111111111',
            name: 'x', uri: 'ipfs://QmTest', expectedOwner: 'x',
            sellerFeeBasisPoints: bad, dryRun: true,
        });
        assert.strictEqual(r.refused, 'royalty_mismatch', `bps=${bad} was not refused`);
    }
    console.log('  PASS every non-500 value refused');
}

async function testNoCompetingConstant(): Promise<void> {
    // The 2000-bps defect lived in a SECOND service with its own constant. A regression would
    // most likely arrive the same way, so scan every source file for royalty constants.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
        for (const f of readdirSync(dir)) {
            const p = join(dir, f);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!p.endsWith('.ts') || p.includes('tests')) { continue; }
            const src = readFileSync(p, 'utf8');
            const rx = /(?:ROYALTY[A-Z_.]*\s*[:=]\s*{[^}]*?BPS\s*:\s*(\d+))|(?:ROYALTY[A-Z_]*BPS\s*[:=]\s*(\d+))/g;
            let m;
            while ((m = rx.exec(src)) !== null) {
                const v = Number(m[1] ?? m[2]);
                if (v !== 500) { offenders.push(`${p}: ${v}`); }
            }
        }
    };
    walk(join(__dirname, '..'));
    assert.strictEqual(offenders.length, 0, 'competing royalty constants: ' + offenders.join('; '));
    console.log('  PASS no competing royalty constant in src/');
}

(async () => {
    console.log('ROYALTY RELEASE TESTS');
    await testLockedConstant();
    await testUpgradeRefusesTwoThousand();
    await testUpgradeRefusesAnyOtherValue();
    await testNoCompetingConstant();
    console.log('ALL ROYALTY RELEASE TESTS PASSED');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
