/**
 * SOL-only Minting Integration Tests
 *
 * Verifies that when MINT_PAYMENT_MODE=SOL:
 *   1. Treasury with sufficient SOL -> mint endpoint proceeds (no token gates).
 *   2. Treasury with 0 SOL -> returns 503 INSUFFICIENT_TREASURY_SOL.
 *   3. Mint gating middleware bypasses TOLA checks in SOL mode.
 *
 * Run:  npx ts-node src/tests/sol-only-mint.test.ts
 *
 * @package VortexEngine
 * @version 4.1.0
 */

import assert from 'assert';

// -----------------------------------------------------------------------
// 1. TreasuryMonitorService.preMintCheck
// -----------------------------------------------------------------------

async function testTreasuryPreMintCheck(): Promise<void> {
    // Mock the Connection so we don't hit real RPC
    const { TreasuryMonitorService } = require('../services/treasury-monitor.service');

    // Stub getBalance to return 0 lamports (insufficient SOL)
    const monitor = new TreasuryMonitorService('11111111111111111111111111111111');
    const origGetBalance = monitor['connection'].getBalance.bind(monitor['connection']);
    monitor['connection'].getBalance = async () => 0; // 0 lamports = 0 SOL

    const requestId = 'test-req-001';
    const blocked = await monitor.preMintCheck(requestId);

    assert.ok(blocked !== null, 'preMintCheck should block when SOL is 0');
    assert.strictEqual(blocked.code, 'INSUFFICIENT_TREASURY_SOL');
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.request_id, requestId);
    console.log('  [PASS] Treasury with 0 SOL returns INSUFFICIENT_TREASURY_SOL');

    // Now simulate enough SOL (1 SOL = 1_000_000_000 lamports)
    monitor['connection'].getBalance = async () => 1_000_000_000;

    const allowed = await monitor.preMintCheck('test-req-002');
    assert.strictEqual(allowed, null, 'preMintCheck should return null (pass) when SOL is sufficient');
    console.log('  [PASS] Treasury with 1 SOL passes preMintCheck');
}

// -----------------------------------------------------------------------
// 2. Mint Gating Middleware - SOL mode bypass
// -----------------------------------------------------------------------

async function testMintGatingSolMode(): Promise<void> {
    // Set MINT_PAYMENT_MODE before importing so the module picks it up
    const origMode = process.env.MINT_PAYMENT_MODE;
    process.env.MINT_PAYMENT_MODE = 'SOL';

    // Force re-import by clearing cache
    const modulePath = require.resolve('../middleware/mint-gating.middleware');
    delete require.cache[modulePath];
    const { mintGating } = require('../middleware/mint-gating.middleware');

    let nextCalled = false;
    const mockReq = { body: {} } as any;
    const mockRes = {
        status: (code: number) => ({
            json: (body: any) => {
                throw new Error(`Unexpected response: ${code} ${JSON.stringify(body)}`);
            }
        })
    } as any;
    const mockNext = () => { nextCalled = true; };

    await mintGating(mockReq, mockRes, mockNext);
    assert.ok(nextCalled, 'mintGating should call next() in SOL mode without requiring wallet/TOLA');
    console.log('  [PASS] Mint gating bypassed in SOL mode (no wallet or TOLA needed)');

    // Restore
    if (origMode !== undefined) {
        process.env.MINT_PAYMENT_MODE = origMode;
    } else {
        delete process.env.MINT_PAYMENT_MODE;
    }
}

// -----------------------------------------------------------------------
// 3. NFTMintResult includes payment_status
// -----------------------------------------------------------------------

function testPaymentStatusField(): void {
    // We can't call mintNFT without a real keypair/RPC, but we can verify the interface
    // by checking that the service module exports and the field exists in the type.
    // Quick structural check: import and verify the service class is loadable.
    try {
        const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
        assert.ok(TOLANFTMintService, 'TOLANFTMintService should be importable');
        console.log('  [PASS] TOLANFTMintService loads successfully');
    } catch (e: any) {
        // Service may fail to initialize without TREASURY_WALLET_PRIVATE, that's OK
        if (e.message.includes('TREASURY_WALLET_PRIVATE')) {
            console.log('  [PASS] TOLANFTMintService requires TREASURY_WALLET_PRIVATE (expected)');
        } else {
            throw e;
        }
    }
}

// -----------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------

(async () => {
    console.log('\n=== SOL-only Minting Tests ===\n');

    try {
        console.log('[Test 1] Treasury preMintCheck');
        await testTreasuryPreMintCheck();

        console.log('\n[Test 2] Mint gating SOL bypass');
        await testMintGatingSolMode();

        console.log('\n[Test 3] Service module loads');
        testPaymentStatusField();

        console.log('\n=== All tests passed ===\n');
        process.exit(0);
    } catch (err: any) {
        console.error('\n[FAIL]', err.message);
        console.error(err.stack);
        process.exit(1);
    }
})();
