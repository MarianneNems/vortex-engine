/**
 * Canonical user-mint refusal battery (Founder directive 2026-08-31).
 *
 * Proves the pathway refuses: missing/short shared secret, altered or expired HMAC,
 * replayed authorization, TOLA payment, mutable HTTP metadata, missing artwork
 * SHA-256, royalty other than 500 bps, invalid recipients, and that the mint
 * address is deterministic from the idempotency key (duplicate clicks converge).
 *
 * Run:  npx ts-node src/tests/user-mint.test.ts
 *
 * @package VortexEngine
 */

import assert from 'assert';
import crypto from 'crypto';
import { requireWpHmac, _resetReplayCache } from '../middleware/wp-hmac.middleware';

const GOOD_SECRET = 'a-shared-secret-that-is-at-least-32-bytes-long!!';
const IDEM_SECRET = 'an-idempotency-secret-also-32-bytes-minimum-!!!!';

let passed = 0;
function ok(label: string) { passed++; console.log(`  [PASS] ${label}`); }

function mockReqRes(body: any, headers: Record<string, string> = {}) {
    const raw = JSON.stringify(body);
    const req: any = { body, rawBody: raw, headers };
    const state = { status: 0, payload: null as any, passed: false };
    const res: any = {
        status(c: number) { state.status = c; return res; },
        json(p: any) { state.payload = p; return res; },
    };
    const next = () => { state.passed = true; };
    return { req, res, next, state };
}

function sign(body: any, secret: string, ts?: string) {
    const t = ts ?? String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', secret).update(`${t}.${JSON.stringify(body)}`).digest('hex');
    return { 'x-vortex-timestamp': t, 'x-vortex-signature': sig };
}

function testHmac(): void {
    // secret missing -> 503, fail closed
    _resetReplayCache();
    delete process.env.WP_RAILWAY_SHARED_SECRET;
    let c = mockReqRes({ a: 1 }, sign({ a: 1 }, GOOD_SECRET));
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.passed, false);
    assert.strictEqual(c.state.status, 503);
    assert.strictEqual(c.state.payload.code, 'MINT_AUTH_NOT_CONFIGURED');
    ok('missing shared secret refuses with 503 (fail closed)');

    // short secret -> 503
    process.env.WP_RAILWAY_SHARED_SECRET = 'short-secret';
    c = mockReqRes({ a: 1 }, sign({ a: 1 }, 'short-secret'));
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.status, 503);
    ok('secret shorter than 32 bytes refuses with 503');

    process.env.WP_RAILWAY_SHARED_SECRET = GOOD_SECRET;

    // no signature headers -> 401
    c = mockReqRes({ a: 1 });
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.status, 401);
    assert.strictEqual(c.state.payload.code, 'MINT_AUTH_MISSING');
    ok('missing signature refuses with 401');

    // stale timestamp -> 401
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    c = mockReqRes({ a: 1 }, sign({ a: 1 }, GOOD_SECRET, stale));
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.payload.code, 'MINT_AUTH_EXPIRED');
    ok('expired timestamp refuses with 401');

    // altered body -> 401
    const headers = sign({ a: 1 }, GOOD_SECRET);
    c = mockReqRes({ a: 2 }, headers);
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.payload.code, 'MINT_AUTH_INVALID');
    ok('altered body refuses with 401');

    // wrong secret -> 401
    c = mockReqRes({ a: 1 }, sign({ a: 1 }, 'another-secret-that-is-32-bytes-long!!!!!!!!' ));
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.status, 401);
    ok('wrong secret refuses with 401');

    // whitespace tolerance: a dashboard paste that picked up a trailing newline must still
    // verify against a signature made with the clean value. This exact invisible difference
    // is what produced an unexplainable mismatch in production.
    _resetReplayCache();
    process.env.WP_RAILWAY_SHARED_SECRET = GOOD_SECRET + '\n';
    c = mockReqRes({ a: 9 }, sign({ a: 9 }, GOOD_SECRET));
    requireWpHmac(c.req, c.res, c.next);
    assert.strictEqual(c.state.passed, true);
    ok('secret with trailing whitespace still matches the clean value');
    process.env.WP_RAILWAY_SHARED_SECRET = GOOD_SECRET;

    // REGRESSION: a body carrying a URI. PHP's wp_json_encode escapes forward slashes as
    // "ipfs:\/\/", Node's JSON.stringify does not. Verification must use the RAW bytes, so a
    // signature made over the PHP form has to verify even though the parsed object would
    // re-stringify differently. This exact case refused every real mint in production.
    _resetReplayCache();
    const phpRaw = '{"metadata_uri":"ipfs:\\/\\/QmAbc123","name":"x"}';
    const parsed = JSON.parse(phpRaw);
    assert.notStrictEqual(JSON.stringify(parsed), phpRaw); // the two forms really do differ
    const tsu = String(Math.floor(Date.now() / 1000));
    const sigu = crypto.createHmac('sha256', GOOD_SECRET).update(`${tsu}.${phpRaw}`).digest('hex');
    const st = { status: 0, payload: null as any, passed: false };
    const reqU: any = { body: parsed, rawBody: phpRaw, headers: { 'x-vortex-timestamp': tsu, 'x-vortex-signature': sigu } };
    const resU: any = { status(c: number) { st.status = c; return resU; }, json(p: any) { st.payload = p; return resU; } };
    requireWpHmac(reqU, resU, () => { st.passed = true; });
    assert.strictEqual(st.passed, true);
    ok('body with escaped slashes verifies against its raw bytes');

    // valid once, replay refused
    _resetReplayCache();
    const h2 = sign({ a: 1 }, GOOD_SECRET);
    const first = mockReqRes({ a: 1 }, h2);
    requireWpHmac(first.req, first.res, first.next);
    assert.strictEqual(first.state.passed, true);
    const replay = mockReqRes({ a: 1 }, h2);
    requireWpHmac(replay.req, replay.res, replay.next);
    assert.strictEqual(replay.state.passed, false);
    assert.strictEqual(replay.state.payload.code, 'MINT_AUTH_REPLAYED');
    ok('valid signature accepted once; its replay refused');
}

async function testRequestLaw(): Promise<void> {
    process.env.MINT_IDEMPOTENCY_SECRET = IDEM_SECRET;
    process.env.WP_RAILWAY_SHARED_SECRET = GOOD_SECRET;
    const { TOLANFTMintService } = require('../services/tola-nft-mint.service');
    const svc = new TOLANFTMintService();
    // Refusal gates must be reachable without a live signer.
    const { Keypair } = require('@solana/web3.js');
    (svc as any)['treasuryKeypair'] = Keypair.fromSeed(Buffer.alloc(32, 7));
    (svc as any)['initialized'] = true;

    const base = () => ({
        idempotency_key: 'wp:member42:asset1001',
        name: 'Test Asset',
        metadata_uri: 'ipfs://QmWTuw1JkduNChb8nFeVPPJyzvGsCSL2QMRUEi8HJGS31q',
        artwork_sha256: 'a'.repeat(64),
        recipient_wallet: '11111111111111111111111111111112',
        collection: 'tola',
        payment: { currency: 'usdc', state: 'paid' },
        dry_run: true,
    });

    let r = await svc.userMint({ ...base(), payment: { currency: 'tola', state: 'paid' } });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.code, 'TOLA_PAYMENT_REFUSED');
    ok('TOLA payment currency refused');

    r = await svc.userMint({ ...base(), payment: { currency: 'usd', state: 'pending' } });
    assert.strictEqual(r.code, 'PAYMENT_NOT_CONFIRMED');
    ok('unconfirmed payment refused');

    r = await svc.userMint({ ...base(), payment: { state: 'included' } });
    assert.notStrictEqual(r.code, 'PAYMENT_NOT_CONFIRMED');
    ok('subscription entitlement (included) passes the payment gate');

    r = await svc.userMint({ ...base(), metadata_uri: 'https://example.com/meta.json' });
    assert.strictEqual(r.code, 'METADATA_NOT_PERMANENT');
    ok('mutable http metadata refused');

    r = await svc.userMint({ ...base(), metadata_uri: 'https://gateway.pinata.cloud/ipfs/QmWTuw1JkduNChb8nFeVPPJyzvGsCSL2QMRUEi8HJGS31q' });
    assert.strictEqual(r.code, 'METADATA_NOT_PERMANENT');
    ok('gateway-form URL refused for user mints (native ipfs:// only)');

    r = await svc.userMint({ ...base(), artwork_sha256: '' });
    assert.strictEqual(r.code, 'ARTWORK_SHA256_MISSING');
    ok('missing artwork sha256 refused');

    r = await svc.userMint({ ...base(), royalty_bps: 1000 });
    assert.strictEqual(r.code, 'ROYALTY_NOT_500');
    ok('royalty other than 500 bps refused');

    r = await svc.userMint({ ...base(), recipient_wallet: 'not-a-wallet' });
    assert.strictEqual(r.code, 'RECIPIENT_INVALID');
    ok('invalid recipient wallet refused');

    r = await svc.userMint({ ...base(), collection: 'other' });
    assert.strictEqual(r.code, 'COLLECTION_INVALID');
    ok('unknown collection lane refused');

    r = await svc.userMint({ ...base(), idempotency_key: 'short' });
    assert.strictEqual(r.code, 'IDEMPOTENCY_KEY_INVALID');
    ok('short idempotency key refused');

    delete process.env.TOLA_COLLECTION_MINT;
    r = await svc.userMint(base());
    assert.strictEqual(r.code, 'MINT_CONFIG_MISSING');
    ok('absent collection env mint refuses (fail closed)');

    const a = (svc as any)['deriveUserMintKeypair']('wp:member42:asset1001').publicKey.toBase58();
    const b = (svc as any)['deriveUserMintKeypair']('wp:member42:asset1001').publicKey.toBase58();
    const c2 = (svc as any)['deriveUserMintKeypair']('wp:member42:asset1002').publicKey.toBase58();
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c2);
    ok('mint address deterministic per idempotency key; distinct keys diverge');

    process.env.MINT_IDEMPOTENCY_SECRET = 'too-short';
    assert.throws(() => (svc as any)['deriveUserMintKeypair']('wp:member42:asset1001'), /32 bytes/);
    ok('short idempotency secret refuses derivation');

    process.env.MINT_IDEMPOTENCY_SECRET = GOOD_SECRET;
    assert.throws(() => (svc as any)['deriveUserMintKeypair']('wp:member42:asset1001'), /distinct/);
    ok('non-distinct secrets refuse derivation');
    process.env.MINT_IDEMPOTENCY_SECRET = IDEM_SECRET;
}

(async () => {
    console.log('[USER-MINT BATTERY]');
    testHmac();
    await testRequestLaw();
    console.log(`\nALL ${passed} USER-MINT REFUSAL TESTS PASS`);
})().catch((e) => { console.error('BATTERY FAILED:', e.message); process.exit(1); });
