/**
 * Payout guard tests (2026-10-07). Run after a build:  node node_modules/typescript/bin/tsc && node --test tests/
 *
 * The USDC transfer endpoint must refuse unsigned requests and never pay the same idempotency_key twice, including
 * after a restart (the on-chain memo), while a send's outcome is unknown, and when two requests race. Nothing here
 * touches the network: the Solana connection is a fake, and the treasury is a throwaway keypair made for this run.
 */
'use strict';

// The services start cleanup intervals; unref them so the test process can end.
const realSetInterval = global.setInterval;
global.setInterval = (...a) => { const t = realSetInterval(...a); if (t && t.unref) { t.unref(); } return t; };

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Keypair, Transaction, SendTransactionError } = require('@solana/web3.js');
const bs58 = require('bs58');

const SECRET = 'test-shared-secret-' + 'x'.repeat(40);
const treasury = Keypair.generate();
process.env.WP_RAILWAY_SHARED_SECRET = SECRET;
process.env.PAYOUT_TREASURY_PRIVATE = (bs58.default || bs58).encode(treasury.secretKey);
delete process.env.TREASURY_WALLET_PRIVATE; // the shared key the other services read: absent unless a test sets it

const { USDCTransferService, SIGNED_PAYOUT, payoutMark } = require('../dist/services/usdc-transfer.service.js');
const { requireWpHmac, requirePayoutHmac, captureMintRawBody, _resetReplayCache } = require('../dist/middleware/wp-hmac.middleware.js');

const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();

function fakeConn() {
    const c = {
        sent: [], lookups: 0, history: [], historyError: null, historyGate: null,
        sendError: null, confirmError: null, confirmErr: null, status: null, height: 10,
        async getSignaturesForAddress() { c.lookups++; if (c.historyGate) { await c.historyGate; } if (c.historyError) { throw c.historyError; } return c.history; },
        async getAccountInfo() { return null; },
        async getLatestBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 100 }; },
        async sendRawTransaction(raw) { c.sent.push(Buffer.from(raw)); if (c.sendError) { throw c.sendError; } return 'ignored'; },
        async confirmTransaction() { if (c.confirmError) { throw c.confirmError; } return { context: { slot: 1 }, value: { err: c.confirmErr } }; },
        async getSignatureStatus() { return { context: { slot: 1 }, value: c.status }; },
        async getBlockHeight() { return c.height; },
        async getTransaction() { return null; },
    };
    return c;
}

function service() {
    const svc = new USDCTransferService();
    const conn = fakeConn();
    svc.connections = [conn];
    svc.currentRpcIndex = 0;
    svc.getBalance = async () => 1e9;
    return { svc, conn };
}

const req = (key, extra = {}) => Object.assign({ user_id: 52, wallet_address: recipient, amount_usdc: 899.85, idempotency_key: key }, extra);

function decode(raw) {
    const tx = Transaction.from(raw);
    const memo = tx.instructions.find((ix) => ix.programId.toBase58() === MEMO);
    const transfer = tx.instructions.find((ix) => ix.programId.toBase58() === SPL_TOKEN_PROGRAM && ix.data[0] === 3);
    return {
        signature: (bs58.default || bs58).encode(tx.signature),
        memo: memo ? memo.data.toString('utf8') : null,
        units: transfer ? transfer.data.readBigUInt64LE(1) : null,
    };
}

test('a caller that did not pass the signature check is refused before anything else', async () => {
    const { svc, conn } = service();
    const r = await svc.transferUSDC(req('tola-dist-0001'));
    assert.equal(r.success, false);
    assert.equal(r.code, 'PAYOUT_NOT_SIGNED');
    assert.equal(svc.statusFor(r), 401);
    assert.equal(conn.lookups + conn.sent.length, 0);
});

test('a signed payout needs a valid idempotency key, amount and wallet', async () => {
    const { svc, conn } = service();
    for (const [extra, code] of [
        [{ idempotency_key: undefined }, 'PAYOUT_KEY_REQUIRED'],
        [{ idempotency_key: 'short' }, 'PAYOUT_KEY_REQUIRED'],
        [{ idempotency_key: 'has spaces in it' }, 'PAYOUT_KEY_REQUIRED'],
        [{ amount_usdc: 0 }, 'PAYOUT_INVALID_AMOUNT'],
        [{ amount_usdc: -5 }, 'PAYOUT_INVALID_AMOUNT'],
        [{ amount_usdc: 0.1234567 }, 'PAYOUT_INVALID_AMOUNT'],
        [{ amount_usdc: 'abc' }, 'PAYOUT_INVALID_AMOUNT'],
        [{ wallet_address: 'not-a-wallet' }, 'PAYOUT_INVALID_WALLET'],
        [{ wallet_address: treasury.publicKey.toBase58() }, 'PAYOUT_INVALID_WALLET'],
    ]) {
        const r = await svc.transferUSDC(req('tola-dist-0002', extra), SIGNED_PAYOUT);
        assert.equal(r.code, code, JSON.stringify(extra));
        assert.equal(svc.statusFor(r), 400);
    }
    assert.equal(conn.lookups + conn.sent.length, 0);
});

test('a valid signed payout is sent once, with its on-chain mark and the exact amount', async () => {
    const { svc, conn } = service();
    const r = await svc.transferUSDC(req('tola-dist-0003', { amount_usdc: 0.29 }), SIGNED_PAYOUT);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(conn.sent.length, 1);
    const tx = decode(conn.sent[0]);
    assert.equal(tx.memo, payoutMark('tola-dist-0003'));
    assert.equal(tx.units, 290000n); // 0.29 USDC, not one unit short
    assert.equal(r.signature, tx.signature);
    assert.equal(conn.lookups, 1, 'the treasury history was searched before sending');
});

test('the same key is refused again in the same process, with the earlier signature', async () => {
    const { svc, conn } = service();
    const first = await svc.transferUSDC(req('tola-dist-0004'), SIGNED_PAYOUT);
    const again = await svc.transferUSDC(req('tola-dist-0004'), SIGNED_PAYOUT);
    assert.equal(again.code, 'PAYOUT_DUPLICATE');
    assert.equal(again.signature, first.signature);
    assert.equal(svc.statusFor(again), 409);
    assert.equal(conn.sent.length, 1);
});

test('after a restart, a key already paid on chain is refused (the memo is the durable record)', async () => {
    const { svc, conn } = service();
    conn.history = [
        { signature: 'OtherPayout1111', err: null, memo: '[46] ' + payoutMark('tola-dist-other') },
        { signature: 'FailedTry2222', err: { InstructionError: [3, 'Custom'] }, memo: '[46] ' + payoutMark('tola-dist-0005') },
        { signature: 'EarlierPayout3333', err: null, memo: '[46] ' + payoutMark('tola-dist-0005') },
    ];
    const r = await svc.transferUSDC(req('tola-dist-0005'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_DUPLICATE');
    assert.equal(r.signature, 'EarlierPayout3333');
    assert.equal(conn.sent.length, 0);
});

test('a failed earlier attempt on chain does not count as paid', async () => {
    const { svc, conn } = service();
    conn.history = [{ signature: 'FailedTry4444', err: { InstructionError: [3, 'Custom'] }, memo: '[46] ' + payoutMark('tola-dist-0006') }];
    const r = await svc.transferUSDC(req('tola-dist-0006'), SIGNED_PAYOUT);
    assert.equal(r.success, true);
    assert.equal(conn.sent.length, 1);
});

test('if the treasury history cannot be read, nothing is sent', async () => {
    const { svc, conn } = service();
    conn.historyError = new Error('rpc down');
    const r = await svc.transferUSDC(req('tola-dist-0007'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_LEDGER_UNAVAILABLE');
    assert.equal(svc.statusFor(r), 503);
    assert.equal(conn.sent.length, 0);
});

test('two requests with the same key at the same moment: one is sent, the other refused', async () => {
    const { svc, conn } = service();
    let release;
    conn.historyGate = new Promise((r) => { release = r; });
    const p1 = svc.transferUSDC(req('tola-dist-0008'), SIGNED_PAYOUT);
    const p2 = await svc.transferUSDC(req('tola-dist-0008'), SIGNED_PAYOUT);
    assert.equal(p2.code, 'PAYOUT_IN_PROGRESS');
    release();
    const r1 = await p1;
    assert.equal(r1.success, true);
    assert.equal(conn.sent.length, 1);
});

test('a send with an unknown outcome is never sent again while it can still land', async () => {
    const { svc, conn } = service();
    conn.confirmError = new Error('confirmation timed out');
    conn.status = null;
    conn.height = 50; // the blockhash (valid to 100) can still land
    const r = await svc.transferUSDC(req('tola-dist-0009'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_OUTCOME_UNKNOWN');
    assert.equal(svc.statusFor(r), 202);
    assert.ok(r.signature);
    const again = await svc.transferUSDC(req('tola-dist-0009'), SIGNED_PAYOUT);
    assert.equal(again.code, 'PAYOUT_IN_PROGRESS');
    conn.status = { confirmationStatus: 'confirmed', err: null };
    const landed = await svc.transferUSDC(req('tola-dist-0009'), SIGNED_PAYOUT);
    assert.equal(landed.code, 'PAYOUT_DUPLICATE');
    assert.equal(landed.signature, r.signature);
    assert.equal(conn.sent.length, 1, 'one transaction, never rebuilt');
});

test('once an unknown send has expired (it can no longer land), the key may be paid', async () => {
    const { svc, conn } = service();
    conn.confirmError = new Error('confirmation timed out');
    const r = await svc.transferUSDC(req('tola-dist-0010'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_OUTCOME_UNKNOWN');
    conn.confirmError = null;
    conn.height = 200; // past the blockhash's last valid height, and never seen on chain
    const retry = await svc.transferUSDC(req('tola-dist-0010'), SIGNED_PAYOUT);
    assert.equal(retry.success, true);
    assert.equal(conn.sent.length, 2);
});

test('a send the node refused before accepting it can be tried again', async () => {
    const { svc, conn } = service();
    conn.sendError = new SendTransactionError({ action: 'send', signature: '', transactionMessage: 'Transaction simulation failed', logs: [] });
    const r = await svc.transferUSDC(req('tola-dist-0011'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_FAILED');
    conn.sendError = null;
    const retry = await svc.transferUSDC(req('tola-dist-0011'), SIGNED_PAYOUT);
    assert.equal(retry.success, true);
    assert.equal(conn.sent.length, 2);
});

test('a network failure during the send is treated as unknown, not as failed', async () => {
    const { svc, conn } = service();
    conn.sendError = new Error('fetch failed');
    conn.height = 50;
    const r = await svc.transferUSDC(req('tola-dist-0012'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_OUTCOME_UNKNOWN');
    conn.sendError = null;
    const again = await svc.transferUSDC(req('tola-dist-0012'), SIGNED_PAYOUT);
    assert.equal(again.code, 'PAYOUT_IN_PROGRESS');
    assert.equal(conn.sent.length, 1);
});

test('without a treasury key every payout is refused', async () => {
    const saved = process.env.PAYOUT_TREASURY_PRIVATE;
    delete process.env.PAYOUT_TREASURY_PRIVATE;
    const svc = new USDCTransferService();
    process.env.PAYOUT_TREASURY_PRIVATE = saved;
    const r = await svc.transferUSDC(req('tola-dist-0013'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_NOT_CONFIGURED');
    assert.equal(svc.statusFor(r), 503);
});

// ---- the dedicated payout key (2026-10-07) ----
const b58 = (k) => (bs58.default || bs58).encode(k.secretKey);
// Every wallet a service instance can sign with: its own Keypair fields, and the Metaplex identity of the NFT service.
function signers(svc) {
    const out = [];
    for (const v of Object.values(svc)) {
        if (v && v.publicKey && v.secretKey) { out.push(v.publicKey.toBase58()); }
    }
    if (svc.metaplex && 'function' === typeof svc.metaplex.identity) { out.push(svc.metaplex.identity().publicKey.toBase58()); }
    return out;
}
function withEnv(env, fn) {
    const saved = { PAYOUT_TREASURY_PRIVATE: process.env.PAYOUT_TREASURY_PRIVATE, TREASURY_WALLET_PRIVATE: process.env.TREASURY_WALLET_PRIVATE };
    for (const [k, v] of Object.entries(env)) { if (undefined === v) { delete process.env[k]; } else { process.env[k] = v; } }
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (undefined === v) { delete process.env[k]; } else { process.env[k] = v; } }
    }
}

test('payouts read only PAYOUT_TREASURY_PRIVATE: the shared treasury key alone leaves them closed (no fallback)', async () => {
    const shared = Keypair.generate();
    const svc = withEnv({ PAYOUT_TREASURY_PRIVATE: undefined, TREASURY_WALLET_PRIVATE: b58(shared) }, () => new USDCTransferService());
    const r = await svc.transferUSDC(req('tola-dist-0014'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_NOT_CONFIGURED');
    assert.equal(svc.getTreasuryAddress(), null);
    assert.deepEqual(signers(svc), []);
    const both = withEnv({ PAYOUT_TREASURY_PRIVATE: '  ' + b58(treasury) + '\n', TREASURY_WALLET_PRIVATE: b58(shared) }, () => new USDCTransferService());
    assert.equal(both.getTreasuryAddress(), treasury.publicKey.toBase58(), 'the dedicated key, pasted with spaces and a newline');
    assert.deepEqual(signers(both), [treasury.publicKey.toBase58()], 'and nothing else');
    // In the source too: the signing key comes from PAYOUT_TREASURY_PRIVATE alone; the shared key is read once, only to
    // refuse the same wallet (that refusal would also hide a fallback from the checks above, so this one looks directly).
    const code = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'services', 'usdc-transfer.service.ts'), 'utf8')
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.deepEqual(code.filter((l) => /\bconst privateKey\b/.test(l)).map((l) => l.trim()), ["const privateKey = (process.env.PAYOUT_TREASURY_PRIVATE || '').trim();"]);
    const sharedReads = code.filter((l) => l.includes('TREASURY_WALLET_PRIVATE') && !l.includes('PAYOUT_TREASURY_PRIVATE') && !/logger\./.test(l));
    assert.equal(sharedReads.length, 1);
    assert.match(sharedReads[0], /^\s*shared = Keypair\.fromSecretKey\(bs58\.decode\(\(process\.env\.TREASURY_WALLET_PRIVATE \|\| ''\)\.trim\(\)\)\)\.publicKey;$/);
});

test('the payout key may not be the shared treasury wallet', async () => {
    const svc = withEnv({ PAYOUT_TREASURY_PRIVATE: b58(treasury), TREASURY_WALLET_PRIVATE: b58(treasury) }, () => new USDCTransferService());
    const r = await svc.transferUSDC(req('tola-dist-0015'), SIGNED_PAYOUT);
    assert.equal(r.code, 'PAYOUT_NOT_CONFIGURED');
    assert.deepEqual(signers(svc), []);
});

// The product NFT mint signs only through the Metaplex identity it is given at start. Where the Metaplex library is
// installed incompletely (Railway installs it whole), a stand-in for that library alone records that identity, so the
// service's own key handling still runs; the test says when it did.
function loadService(file, name, t) {
    try {
        return require(file)[name];
    } catch (e) {
        if (!/Cannot find module/.test(e.message) || !/@metaplex-foundation/.test(e.message)) { throw e; }
        const Module = require('module');
        const load = Module._load;
        Module._load = function (request, ...rest) {
            if ('@metaplex-foundation/js' !== request) { return load.call(this, request, ...rest); }
            return {
                Metaplex: { make: () => ({ id: null, use(p) { this.id = p.keypair; return this; }, identity() { return this.id; } }) },
                keypairIdentity: (keypair) => ({ keypair }),
                toMetaplexFile: () => ({}),
            };
        };
        try {
            t.diagnostic(`${name}: the Metaplex library is incomplete here; checked with a stand-in that records the signing identity`);
            return require(file)[name];
        } finally {
            Module._load = load;
        }
    }
}

test('TOLA transfers, NFT transfers and minting, collections and the marketplace cannot read or use the payout key', (t) => {
    const classes = {
        'TOLA transfers': loadService('../dist/services/tola-transfer.service.js', 'TOLATransferService', t),
        'NFT mint and transfer': loadService('../dist/services/tola-nft-mint.service.js', 'TOLANFTMintService', t),
        'product NFT mint': loadService('../dist/services/nft-mint.service.js', 'NFTMintService', t),
        'collections': loadService('../dist/services/collection.service.js', 'CollectionService', t),
        'marketplace': loadService('../dist/services/marketplace.service.js', 'MarketplaceService', t),
    };
    const payout = treasury.publicKey.toBase58();
    const shared = Keypair.generate();
    for (const [name, Cls] of Object.entries(classes)) {
        const alone = withEnv({ PAYOUT_TREASURY_PRIVATE: b58(treasury), TREASURY_WALLET_PRIVATE: undefined }, () => new Cls());
        assert.equal(alone.initialized, false, `${name}: not switched on by the payout key`);
        assert.ok(!signers(alone).includes(payout), `${name}: does not hold the payout key`);
        const both = withEnv({ PAYOUT_TREASURY_PRIVATE: b58(treasury), TREASURY_WALLET_PRIVATE: b58(shared) }, () => new Cls());
        assert.ok(signers(both).includes(shared.publicKey.toBase58()) && !signers(both).includes(payout), `${name}: signs only with its own shared key`);
    }
    // Statically: the payout key is named in one source file only.
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const readers = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); } else if (/\.(ts|js|cjs|mjs)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('PAYOUT_TREASURY_PRIVATE')) { readers.push(path.relative(root, p).split(path.sep).join('/')); }
        }
    };
    walk(path.join(root, 'src'));
    assert.deepEqual(readers, ['src/services/usdc-transfer.service.ts']);
});

test('the Stripe-purchase webhook can no longer move USDC, and says so', async () => {
    const { webhookProcessor } = require('../dist/services/webhook-processor.service.js');
    const { svc, conn } = service();
    webhookProcessor.setServices({ usdc: svc });
    const r = await webhookProcessor.processWebhook('stripe.purchase', { user: { id: 7, wallet_address: recipient }, payment: { amount: 100, intent_id: 'pi_test' } });
    assert.equal(r.success, false);
    assert.equal(r.action_taken, 'refused');
    assert.equal(r.data.code, 'PAYOUT_NOT_SIGNED');
    assert.equal(conn.sent.length + conn.lookups, 0);
});

// ---------------------------------------------------------------- the signature check

function mockRes() {
    return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function signedReq(body, opts = {}) {
    const raw = JSON.stringify(body);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', opts.secret ?? SECRET).update(`${ts}.${raw}`).digest('hex');
    return { headers: { 'x-vortex-timestamp': ts, 'x-vortex-signature': sig }, rawBody: raw, body };
}

test('the payout check refuses missing, wrong, stale and replayed signatures, and marks a good one', () => {
    _resetReplayCache();
    let res = mockRes();
    requirePayoutHmac({ headers: {}, body: {} }, res, () => assert.fail('must not pass'));
    assert.deepEqual([res.statusCode, res.body.code], [401, 'PAYOUT_AUTH_MISSING']);
    res = mockRes();
    requirePayoutHmac(signedReq({ a: 1 }, { secret: 'wrong-secret-' + 'y'.repeat(40) }), res, () => assert.fail('must not pass'));
    assert.deepEqual([res.statusCode, res.body.code], [401, 'PAYOUT_AUTH_INVALID']);
    res = mockRes();
    requirePayoutHmac(signedReq({ a: 1 }, { ts: Math.floor(Date.now() / 1000) - 3600 }), res, () => assert.fail('must not pass'));
    assert.deepEqual([res.statusCode, res.body.code], [401, 'PAYOUT_AUTH_EXPIRED']);
    const good = signedReq({ a: 2 });
    let passed = false;
    requirePayoutHmac(good, mockRes(), () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(good.vortexSignedPayout, SIGNED_PAYOUT);
    res = mockRes();
    requirePayoutHmac(Object.assign({}, good, { vortexSignedPayout: undefined }), res, () => assert.fail('a replay must not pass'));
    assert.deepEqual([res.statusCode, res.body.code], [401, 'PAYOUT_AUTH_REPLAYED']);
});

test('no shared secret, no payouts (fail closed)', () => {
    const saved = process.env.WP_RAILWAY_SHARED_SECRET;
    process.env.WP_RAILWAY_SHARED_SECRET = 'too-short';
    const res = mockRes();
    requirePayoutHmac(signedReq({ a: 3 }), res, () => assert.fail('must not pass'));
    process.env.WP_RAILWAY_SHARED_SECRET = saved;
    assert.deepEqual([res.statusCode, res.body.code], [503, 'PAYOUT_AUTH_NOT_CONFIGURED']);
});

test('the mint check answers exactly as before', () => {
    _resetReplayCache();
    const saved = process.env.WP_RAILWAY_SHARED_SECRET;
    process.env.WP_RAILWAY_SHARED_SECRET = '';
    let res = mockRes();
    requireWpHmac(signedReq({ m: 1 }), res, () => assert.fail('must not pass'));
    process.env.WP_RAILWAY_SHARED_SECRET = saved;
    assert.deepEqual(res.body, { success: false, code: 'MINT_AUTH_NOT_CONFIGURED', error: 'Mint authorization secret is not installed. The endpoint is disabled until it is.' });
    assert.equal(res.statusCode, 503);
    res = mockRes();
    requireWpHmac({ headers: {}, body: {} }, res, () => assert.fail('must not pass'));
    assert.deepEqual([res.statusCode, res.body.code, res.body.error], [401, 'MINT_AUTH_MISSING', 'Missing or malformed authorization headers.']);
    const good = signedReq({ m: 2 });
    let passed = false;
    requireWpHmac(good, mockRes(), () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(good.vortexSignedPayout, undefined, 'a mint signature never marks a payout');
});

// ---------------------------------------------------------------- the endpoint, wired as in server.ts

test('the endpoint over HTTP: unsigned refused, signed paid once, repeats refused', async () => {
    _resetReplayCache();
    const express = require('express');
    const bodyParser = require('body-parser');
    const routes = require('../dist/routes/usdc.routes.js');
    const svc = routes.usdcTransferService;
    const conn = fakeConn();
    svc.connections = [conn];
    svc.currentRpcIndex = 0;
    svc.getBalance = async () => 1e9;
    const app = express();
    app.use('/api/usdc/transfer', captureMintRawBody);
    app.use(bodyParser.json());
    app.post('/api/usdc/transfer', requirePayoutHmac);
    app.use('/api/usdc', routes.usdcRoutes);
    const server = app.listen(0);
    const url = `http://127.0.0.1:${server.address().port}/api/usdc/transfer`;
    const post = async (raw, headers = {}) => {
        const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: raw });
        return { status: r.status, body: await r.json() };
    };
    const sign = (raw, ts = Math.floor(Date.now() / 1000)) => ({ 'x-vortex-timestamp': String(ts), 'x-vortex-signature': crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex') });
    try {
        const body = JSON.stringify({ user_id: 52, wallet_address: recipient, amount_usdc: 2549.575, idempotency_key: 'tola-dist-http-1' });
        let r = await post(body);
        assert.deepEqual([r.status, r.body.code], [401, 'PAYOUT_AUTH_MISSING']);
        r = await post(body, { 'x-vortex-timestamp': String(Math.floor(Date.now() / 1000)), 'x-vortex-signature': 'a'.repeat(64) });
        assert.deepEqual([r.status, r.body.code], [401, 'PAYOUT_AUTH_INVALID']);
        assert.equal(conn.lookups + conn.sent.length, 0, 'nothing reached the service');
        const nokey = JSON.stringify({ user_id: 52, wallet_address: recipient, amount_usdc: 1 });
        r = await post(nokey, sign(nokey));
        assert.deepEqual([r.status, r.body.code], [400, 'PAYOUT_KEY_REQUIRED']);
        const h = sign(body);
        r = await post(body, h);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(conn.sent.length, 1);
        assert.equal(decode(conn.sent[0]).units, 2549575000n);
        r = await post(body, h);
        assert.deepEqual([r.status, r.body.code], [401, 'PAYOUT_AUTH_REPLAYED']);
        r = await post(body, sign(body, Math.floor(Date.now() / 1000) - 1));
        assert.deepEqual([r.status, r.body.code], [409, 'PAYOUT_DUPLICATE']);
        assert.equal(conn.sent.length, 1, 'paid exactly once');
    } finally {
        server.close();
    }
});
