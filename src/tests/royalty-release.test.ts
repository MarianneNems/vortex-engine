/**
 * Royalty Release Tests - LANE-AWARE CANON (Founder-ratified TOLA strategy, 2026-09-01).
 *
 * Two lanes, both enforced:
 *
 *   HISTORICAL / MEMBER LANE - 500 bps. The repair path (upgradeExistingMint) and the
 *   member creator-lane mint stay locked at 500; the 65 certified works carry 500 on
 *   chain as finalized fact until a Founder-approved manifest updates them.
 *
 *   NEW TOLA MASTERPIECE LANE - 2000 bps: 5% of gross to the creator of VORTEX and 15%
 *   of gross divided EQUALLY among the work's verified participants (a 25/75 pool
 *   split). Frozen in src/config/tola-royalty-policy.ts; no environment variable can
 *   change the rate or break participant equality; remainders are carried, never paid
 *   to the creator.
 *
 * This file supersedes the earlier "no non-500 constant anywhere" scan, which the
 * lane-aware canon makes wrong by construction.
 *
 * Run:  npx ts-node src/tests/royalty-release.test.ts
 */

import assert from 'assert';

let passed = 0;
function ok(label: string) { passed++; console.log(`  PASS ${label}`); }

// ---------------------------------------------------------------------------
// Historical / member lane: 500 stays locked
// ---------------------------------------------------------------------------

async function testRepairLaneLockedAt500(): Promise<void> {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(join(__dirname, '../services/tola-nft-mint.service.ts'), 'utf8');
    const m = src.match(/BPS:\s*(\d+)/);
    assert(m, 'IMMUTABLE_ROYALTY.BPS not found');
    assert.strictEqual(Number(m[1]), 500, `repair-lane BPS is ${m[1]}, must stay 500`);
    ok('repair/member lane constant is 500 bps');

    const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
    const svc = new TOLANFTMintService();
    for (const bad of [0, 499, 501, 1000, 2000, 10000]) {
        const r = await svc.upgradeExistingMint({
            mint: '11111111111111111111111111111111',
            name: 'x', uri: 'ipfs://QmTest', expectedOwner: 'x',
            sellerFeeBasisPoints: bad, dryRun: true,
        });
        assert.strictEqual(r.refused, 'royalty_mismatch', `repair path accepted bps=${bad}`);
    }
    ok('repair path refuses every non-500 value, including 2000');
}

// ---------------------------------------------------------------------------
// New TOLA Masterpiece lane: canonical 2000 with exact 5/15 economics
// ---------------------------------------------------------------------------

async function testTolaPolicyConstants(): Promise<void> {
    const P = require('../config/tola-royalty-policy');
    assert.strictEqual(P.TOLA_SECONDARY_ROYALTY_BPS, 2000);
    assert.strictEqual(P.CREATOR_POOL_SHARE, 25);
    assert.strictEqual(P.PARTICIPANT_POOL_SHARE, 75);
    assert.strictEqual(P.CREATOR_GROSS_PERCENT, 5);
    assert.strictEqual(P.PARTICIPANT_GROSS_PERCENT, 15);
    assert.strictEqual(P.CREATOR_POOL_SHARE + P.PARTICIPANT_POOL_SHARE, 100);
    ok('TOLA lane canon: 2000 bps, pool 25/75, gross 5% + 15%');
}

async function testEnvironmentCannotOverride(): Promise<void> {
    process.env.TOLA_SECONDARY_ROYALTY_BPS = '100';
    process.env.CREATOR_POOL_SHARE = '90';
    process.env.ROYALTY_BPS = '0';
    delete require.cache[require.resolve('../config/tola-royalty-policy')];
    const P = require('../config/tola-royalty-policy');
    assert.strictEqual(P.TOLA_SECONDARY_ROYALTY_BPS, 2000);
    assert.strictEqual(P.CREATOR_POOL_SHARE, 25);
    ok('environment variables cannot override the canonical royalty');
}

async function testGrossEntitlements(): Promise<void> {
    const P = require('../config/tola-royalty-policy');
    for (let n = 1; n <= 9; n++) {
        const e = P.participantGrossEntitlement(n);
        assert.ok(Math.abs(e * n - 15) < 1e-12, `entitlements for N=${n} do not total 15%`);
    }
    assert.strictEqual(P.participantGrossEntitlement(3), 5);
    assert.strictEqual(P.participantGrossEntitlement(5), 3);
    ok('each participant gross entitlement is exactly 15%/N for N=1..9');
}

async function testDirectModeGating(): Promise<void> {
    const P = require('../config/tola-royalty-policy');
    // representable equal shares AND within Metaplex's five creator entries
    assert.strictEqual(P.directModeAllowed(1), true);   // 75
    assert.strictEqual(P.directModeAllowed(3), true);   // 25 each
    assert.strictEqual(P.directModeAllowed(2), false);  // 37.5 not representable
    assert.strictEqual(P.directModeAllowed(4), false);  // 18.75 not representable
    assert.strictEqual(P.directModeAllowed(5), false);  // 6 entries exceed the limit
    assert.strictEqual(P.directModeAllowed(9), false);
    assert.strictEqual(P.royaltyMode(9), 'vault');
    ok('direct mode only where equality is exact and entries fit; vault otherwise');
}

async function testDirectListShares(): Promise<void> {
    const P = require('../config/tola-royalty-policy');
    const list = P.buildDirectCreatorList('CreatorWallet1111111111111111111111111111111',
        ['Pa111111111111111111111111111111111111111111',
         'Pb111111111111111111111111111111111111111111',
         'Pc111111111111111111111111111111111111111111']);
    assert.strictEqual(list.length, 4);
    assert.strictEqual(list[0].share, 25);
    assert.ok(list.slice(1).every((c: any) => c.share === 25));
    assert.strictEqual(list.reduce((s: number, c: any) => s + c.share, 0), 100);
    assert.ok(list.every((c: any) => c.verified === false), 'verified must never be pre-claimed');
    assert.throws(() => P.buildDirectCreatorList('W', ['A', 'B']), /vault mode/);
    ok('direct creator list: shares total 100, equal, verification never pre-claimed');
}

async function testVaultSplitAndRemainder(): Promise<void> {
    const P = require('../config/tola-royalty-policy');
    const v = P.buildVaultCreatorList('CreatorWallet1111111111111111111111111111111',
        'VaultWallet111111111111111111111111111111111');
    assert.strictEqual(v[0].share, 25);
    assert.strictEqual(v[1].share, 75);
    assert.throws(() => P.buildVaultCreatorList('Same', 'Same'), /distinct/);

    // 100 units across 9 participants: 11 each, 1 carried - the creator NEVER absorbs it
    const s = P.splitPoolAmount(100n, 9);
    assert.strictEqual(s.each, 11n);
    assert.strictEqual(s.carry, 1n);
    assert.strictEqual(s.each * 9n + s.carry, 100n);
    ok('vault split is 25/75; settlement remainders carried, never to the creator');
}

// ---------------------------------------------------------------------------
// Fail-closed market data and retired swap execution
// ---------------------------------------------------------------------------

async function testNoInventedMarketNumbers(): Promise<void> {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(join(__dirname, '../services/tola.service.ts'), 'utf8');
    assert.ok(!/fallback price \$1\.00/.test(src), 'the $1.00 fallback log line is back');
    assert.ok(!src.includes('getFallbackSnapshot'), 'invented-numbers fallback is back');
    assert.ok(src.includes('getUnavailableSnapshot'), 'unavailable snapshot missing');
    assert.ok(src.includes('stale: true'), 'stale marking on cached data missing');
    ok('market data fails closed: no invented prices, stale cache is labeled');
}

async function testSwapExecutionRetired(): Promise<void> {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(join(__dirname, '../routes/swap.routes.ts'), 'utf8');
    assert.ok(src.includes('SWAP_EXECUTION_UNAVAILABLE'), 'swap execute retirement missing');
    const executeBlock = src.slice(src.indexOf("router.post('/execute'"));
    assert.ok(!executeBlock.includes('swapTransaction'), 'execute path can still return a signable transaction');
    ok('public swap execution retired; quote surface returns no signable bytes');
}

(async () => {
    console.log('[ROYALTY RELEASE BATTERY - lane-aware canon]');
    await testRepairLaneLockedAt500();
    await testTolaPolicyConstants();
    await testEnvironmentCannotOverride();
    await testGrossEntitlements();
    await testDirectModeGating();
    await testDirectListShares();
    await testVaultSplitAndRemainder();
    await testNoInventedMarketNumbers();
    await testSwapExecutionRetired();
    console.log(`\nALL ${passed} ROYALTY RELEASE TESTS PASSED`);
})().catch((e) => { console.error('BATTERY FAILED:', e.message); process.exit(1); });
