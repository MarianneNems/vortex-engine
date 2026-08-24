/**
 * Proof for the standards-upgrade path: instruction encoding, royalty lock and refusals.
 *
 * Hermetic. No RPC, no signer, no network. Every assertion reads bytes the code would put on
 * chain, because an instruction that is merely "probably right" is discovered at submission time
 * and cannot be taken back.
 *
 * The byte layouts asserted here were read from the installed
 * @metaplex-foundation/mpl-token-metadata generated builders, so this is a cross-check against the
 * reference implementation rather than against my own assumptions.
 *
 * Requires a build first, because it asserts against the emitted JS:
 *   npm run build && node standards-upgrade-proof.cjs
 */
'use strict';

// Nothing in this file may reach a provider. Prove that before loading anything that could.
process.env.TREASURY_WALLET_PRIVATE = '';

const { PublicKey, SystemProgram } = require('@solana/web3.js');
const { TOLANFTMintService } = require('./dist/services/tola-nft-mint.service');

let pass = 0, fail = 0;
function t(ok, label, detail) {
    if (ok) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}

const svc = new TOLANFTMintService();
const MINT = new PublicKey('66Hjkg2oGxsLLtb1fd6m2GCT1P7YEqRbhVRMEwJqqnpD');
const COLL = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const AUTH = new PublicKey('EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz');
const META_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// Real-shaped identifiers. Earlier fixtures used 7-character stubs, which the length floor in
// isPermanentUri correctly rejected - the fixtures were wrong, not the gate.
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';   // CIDv1, 59 chars
const ARTX = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';                   // Arweave tx id, 43
const IPFS_URI = `ipfs://${CID}`;
const AR_URI = `ar://${ARTX}`;
const GATEWAY_URI = `https://gateway.pinata.cloud/ipfs/${CID}`;

console.log('\n--- CreateMasterEditionV3 ---');
const me = svc.buildCreateMasterEditionV3Ix({
    edition: MINT, mint: MINT, updateAuthority: AUTH, mintAuthority: AUTH,
    payer: AUTH, metadata: MINT, maxSupply: 0,
});
t(me.data[0] === 17, 'discriminator is 17');
t(me.data[1] === 1, 'maxSupply is Some, not None');
t(me.data.length === 10, 'data is 1 + 1 + 8 bytes', `got ${me.data.length}`);
t(me.data.readBigUInt64LE(2) === 0n, 'maxSupply is 0 so no prints can ever be struck');
t(me.programId.toBase58() === META_PROGRAM, 'targets the Token Metadata program');
t(me.keys.length === 8, 'eight accounts', `got ${me.keys.length}`);
t(me.keys[0].isWritable === true, 'edition is writable');
t(me.keys[1].isWritable === true, 'mint is writable');
t(me.keys[2].isSigner === true, 'update authority signs');
t(me.keys[3].isSigner === true, 'mint authority signs');
t(me.keys[4].isSigner === true && me.keys[4].isWritable === true, 'payer signs and is writable');
t(me.keys[5].isWritable === true, 'metadata is writable');
t(me.keys[7].pubkey.equals(SystemProgram.programId), 'system program is last');

// A Master Edition with maxSupply > 0 would allow prints of a 1/1. Prove the field is real.
const me2 = svc.buildCreateMasterEditionV3Ix({
    edition: MINT, mint: MINT, updateAuthority: AUTH, mintAuthority: AUTH,
    payer: AUTH, metadata: MINT, maxSupply: 5,
});
t(me2.data.readBigUInt64LE(2) === 5n, 'maxSupply is encoded, not hardcoded to zero');

console.log('\n--- VerifySizedCollectionItem ---');
const vc = svc.buildVerifySizedCollectionItemIx({
    metadata: MINT, collectionAuthority: AUTH, payer: AUTH,
    collectionMint: COLL, collectionMetadata: COLL, collectionMasterEdition: COLL,
});
t(vc.data.length === 1 && vc.data[0] === 30, 'discriminator is 30 with no args');
t(vc.keys.length === 6, 'six accounts', `got ${vc.keys.length}`);
t(vc.keys[1].isSigner === true, 'collection authority signs');
t(vc.keys[2].isSigner === true && vc.keys[2].isWritable === true, 'payer signs and is writable');
t(vc.keys[4].isWritable === true, 'collection metadata is writable');

console.log('\n--- CreateMetadataAccountV3 collection field ---');
const withColl = svc.buildCreateMetadataV3Ix({
    metadata: MINT, mint: MINT, mintAuthority: AUTH, payer: AUTH, updateAuthority: AUTH,
    name: 'Whimsy in a Pink Dreamscape', symbol: 'TOLA', uri: GATEWAY_URI,
    sellerFeeBasisPoints: 500,
    creators: [{ address: AUTH, verified: true, share: 100 }],
    collection: COLL,
});
const noColl = svc.buildCreateMetadataV3Ix({
    metadata: MINT, mint: MINT, mintAuthority: AUTH, payer: AUTH, updateAuthority: AUTH,
    name: 'x', symbol: 'TOLA', uri: GATEWAY_URI, sellerFeeBasisPoints: 500,
    creators: [{ address: AUTH, verified: true, share: 100 }],
});
t(withColl.data.length === noColl.data.length + 33 + 26,
    'Some(collection) adds 1 tag + 1 verified + 32 key over None',
    `${withColl.data.length} vs ${noColl.data.length}`);

// The collection key must be present in the encoded bytes, and verified must be false.
const collIdx = withColl.data.indexOf(COLL.toBuffer());
t(collIdx > 0, 'collection pubkey is present in the encoded data');
t(withColl.data[collIdx - 1] === 0,
    'collection.verified is FALSE at creation, only VerifySizedCollectionItem may set it');

// Royalty must be encoded as 500, little-endian u16.
const feeIdx = withColl.data.indexOf(Buffer.from([0xf4, 0x01]));
t(feeIdx > 0, 'sellerFeeBasisPoints 500 encoded little-endian u16');

console.log('\n--- royalty lock ---');
(async () => {
    const r1 = await svc.upgradeExistingMint({
        mint: MINT.toBase58(), name: 'x', uri: GATEWAY_URI,
        collectionMint: COLL.toBase58(), expectedOwner: AUTH.toBase58(), sellerFeeBasisPoints: 2000,
    });
    t(r1.success === false && r1.refused === 'royalty_mismatch',
        'a 2000 bps request is REFUSED, not silently corrected', JSON.stringify(r1));

    console.log('\n--- permanent URI required ---');
    for (const [uri, label] of [
        ['https://vortex-engine-production.up.railway.app/api/tola/metadata/abc', 'Railway URL refused'],
        ['https://vortexartec.com/wp-content/uploads/2026/07/x.png', 'WordPress upload URL refused'],
        ['http://example.com/x.json', 'arbitrary http URL refused'],
    ]) {
        const r = await svc.upgradeExistingMint({
            mint: MINT.toBase58(), name: 'x', uri,
            collectionMint: COLL.toBase58(), expectedOwner: AUTH.toBase58(),
        });
        t(r.success === false && r.refused === 'uri_not_permanent', label, JSON.stringify(r));
    }
    for (const [uri, label] of [
        [IPFS_URI, 'ipfs:// accepted past the URI gate'],
        [AR_URI, 'ar:// accepted past the URI gate'],
        [GATEWAY_URI, 'pinata ipfs gateway accepted past the URI gate'],
    ]) {
        const r = await svc.upgradeExistingMint({
            mint: MINT.toBase58(), name: 'x', uri,
            collectionMint: COLL.toBase58(), expectedOwner: AUTH.toBase58(),
        });
        // With no signer configured this must stop at signer_unavailable, NOT at uri_not_permanent.
        t(r.refused === 'signer_unavailable', label, JSON.stringify(r));
    }

    console.log('\n--- default deny without a signer ---');
    const r2 = await svc.upgradeExistingMint({
        mint: MINT.toBase58(), name: 'x', uri: IPFS_URI,
        collectionMint: COLL.toBase58(), expectedOwner: AUTH.toBase58(),
    });
    t(r2.success === false && r2.refused === 'signer_unavailable',
        'no signer configured means refuse, never proceed');

    console.log('\n--- the upgrade never burns, remints or relinks ---');
    const src = require('fs').readFileSync('./src/services/tola-nft-mint.service.ts', 'utf8');
    const fn = src.slice(src.indexOf('async upgradeExistingMint('), src.indexOf('async mintNFT('));
    // Strip comments so a comment promising not to burn cannot satisfy the check.
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['createBurnInstruction', 'createMintToInstruction', 'closeAccount', 'createInitializeMintInstruction']) {
        t(!code.includes(forbidden), `upgrade path never calls ${forbidden}`);
    }
    t(code.includes('simulateTransaction'), 'upgrade path simulates before submitting');
    t(code.includes('outcome_unknown'), 'a confirmation timeout is recorded as outcome_unknown');
    t(code.includes('metadata_already_exists'), 'an already-upgraded mint is refused, not overwritten');

    console.log('\n--- storage fails closed ---');
    const routes = require('fs').readFileSync('./src/routes/tola-compat.routes.ts', 'utf8');
    const storeFn = routes.slice(routes.indexOf('async function storeMetadata'), routes.indexOf('async function retrieveAndHash'));
    const storeCode = storeFn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    t(!storeCode.includes('writeFileSync'), 'storeMetadata no longer writes a local Railway file');
    t(!/ENGINE_URL/.test(storeCode), 'storeMetadata no longer returns an engine-hosted URI');
    t(/success:\s*false/.test(storeCode), 'storeMetadata returns failure when permanent storage is unavailable');

    console.log(`\n=============================================`);
    console.log(`  STANDARDS UPGRADE PROOF: ${pass} passed, ${fail} failed`);
    console.log(`=============================================`);
    process.exit(fail > 0 ? 1 : 0);
})();
