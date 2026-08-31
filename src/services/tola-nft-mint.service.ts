/**
 * TOLA NFT Mint Service - Production Grade
 * Handles NFT minting on Solana blockchain using Metaplex
 * 
 * Features:
 * - Full Metaplex Token Metadata integration
 * - NFT minting with customizable metadata
 * - Collection support
 * - Transfer functionality
 * - Metadata fetching
 * - Batch minting support
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction, 
    sendAndConfirmTransaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    ComputeBudgetProgram,
    TransactionInstruction
} from '@solana/web3.js';
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    transfer,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createTransferInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getMint
} from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

// Metaplex Token Metadata Program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// VORTEX ROYALTY CONFIGURATION (reconciled 2026-06-18, founder-approved 5% model).
// Single, unambiguous model: total on-chain royalty = 5% (sellerFeeBasisPoints=500),
// 100% of that 5% to the VORTEX royalty wallet. Matches what WordPress already sends
// (create_nft_contract -> seller_fee_basis_points: 500). The prior 20% / 25-share split
// is intentionally removed. Artist attribution is preserved via the creators array
// (share=0, attribution-only) plus the metadata JSON attributes (off-chain uri).
const IMMUTABLE_ROYALTY = {
    BPS: 500,           // 5% total on-chain royalty - VORTEX
    RATE: 0.05,         // 5% as decimal
    WALLET: process.env.SYSTEM_CREATOR_ROYALTY_WALLET || 'EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz',
    IMMUTABLE: true,
    LOCKED_DATE: '2026-06-18'
} as const;

// Verify the reconciled 5% model has not been tampered with.
if (IMMUTABLE_ROYALTY.BPS !== 500 || IMMUTABLE_ROYALTY.RATE !== 0.05) {
    throw new Error('[TOLA NFT SERVICE] CRITICAL: Royalty configuration has been tampered with!');
}

// -----------------------------------------------------------------------
// MINT_PAYMENT_MODE  (SOL | TOLA | USDC)
// When SOL (default / recommended for launch):
//   - No token-program transfers are performed for fees
//   - No token account creation for fee payment
//   - Only treasury SOL balance check + standard Metaplex mint transaction
// -----------------------------------------------------------------------
const MINT_PAYMENT_MODE = (process.env.MINT_PAYMENT_MODE || 'SOL').toUpperCase();
const ESTIMATED_MINT_COST_SOL = parseFloat(process.env.ESTIMATED_MINT_COST_SOL || '0.012');

// Configuration
const CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    confirmationTimeout: 60000,
    priorityFee: 100000,
    computeUnits: 400000,
    defaultSellerFeeBasisPoints: IMMUTABLE_ROYALTY.BPS, // 20% IMMUTABLE
    defaultSymbol: 'VORTEX'
};

// RPC endpoints
const RPC_ENDPOINTS = [
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com'
];

export interface NFTMintRequest {
    name: string;
    symbol?: string;
    uri: string;
    description?: string;
    image?: string;
    seller_fee_basis_points?: number;
    creators?: Array<{
        address: string;
        share: number;
        verified?: boolean;
    }>;
    collection?: string;
    attributes?: Array<{
        trait_type: string;
        value: string | number;
    }>;
    recipient?: string;
    is_mutable?: boolean;
    metadata?: Record<string, any>;
}

export interface NFTMintResult {
    success: boolean;
    mint_address?: string;
    metadata_address?: string;
    token_account?: string;
    signature?: string;
    error?: string;
    explorer_url?: string;
    fee?: number;
    payment_status?: string;
}

export interface NFTTransferRequest {
    mint_address: string;
    recipient_wallet: string;
    from_wallet?: string;
}

export interface NFTTransferResult {
    success: boolean;
    signature?: string;
    error?: string;
    explorer_url?: string;
}

export interface NFTInfo {
    success: boolean;
    mint_address?: string;
    name?: string;
    symbol?: string;
    uri?: string;
    description?: string;
    image?: string;
    owner?: string;
    creators?: Array<{ address: string; share: number; verified: boolean }>;
    seller_fee_basis_points?: number;
    attributes?: Array<{ trait_type: string; value: any }>;
    collection?: string;
    error?: string;
}

interface MintedNFT {
    mint_address: string;
    name: string;
    uri: string;
    created_at: Date;
    owner: string;
    signature: string;
}

export class TOLANFTMintService {
    private connections: Connection[] = [];
    private currentRpcIndex: number = 0;
    private treasuryKeypair: Keypair | null = null;
    private initialized: boolean = false;
    private mintedNFTs: MintedNFT[] = [];
    private totalMinted: number = 0;

    constructor() {
        // Initialize connections
        for (const rpcUrl of RPC_ENDPOINTS) {
            try {
                this.connections.push(new Connection(rpcUrl, {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: CONFIG.confirmationTimeout
                }));
            } catch (e) {
                logger.warn(`[NFT Service] Failed to connect to ${rpcUrl}`);
            }
        }
        
        if (this.connections.length === 0) {
            logger.error('[NFT Service] No RPC connections available');
            return;
        }
        
        // Initialize treasury keypair
        const privateKey = process.env.TREASURY_WALLET_PRIVATE;
        if (privateKey) {
            try {
                const decoded = bs58.decode(privateKey);
                this.treasuryKeypair = Keypair.fromSecretKey(decoded);
                this.initialized = true;
                logger.info(`[NFT Service] Initialized with treasury: ${this.treasuryKeypair.publicKey.toBase58().slice(0, 8)}...`);
            } catch (error: any) {
                logger.error('[NFT Service] Invalid TREASURY_WALLET_PRIVATE:', error.message);
            }
        } else {
            logger.warn('[NFT Service] No TREASURY_WALLET_PRIVATE configured - minting disabled');
        }
    }

    /**
     * Get active connection
     */
    private getConnection(): Connection {
        return this.connections[this.currentRpcIndex] || this.connections[0];
    }

    /**
     * Switch RPC endpoint
     */
    private switchRpc(): void {
        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.connections.length;
        logger.info(`[NFT Service] Switched to RPC ${this.currentRpcIndex + 1}`);
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get metadata PDA address
     */
    private getMetadataAddress(mint: PublicKey): PublicKey {
        const [metadataAddress] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer()
            ],
            TOKEN_METADATA_PROGRAM_ID
        );
        return metadataAddress;
    }

    /**
     * Get master edition PDA address
     */
    private getMasterEditionAddress(mint: PublicKey): PublicKey {
        const [masterEditionAddress] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
                Buffer.from('edition')
            ],
            TOKEN_METADATA_PROGRAM_ID
        );
        return masterEditionAddress;
    }

    /**
     * Hand-built CreateMetadataAccountV3 instruction.
     *
     * mpl-token-metadata v3 ships umi-only builders, so we serialize the
     * instruction directly for the @solana/web3.js Transaction. This is the
     * step that was MISSING — without it the mint is a bare SPL token with no
     * name/image/creators/royalty. With it, each TOLA Masterpiece becomes a
     * real on-chain NFT carrying the 20% seller-fee royalty (5% creator + 15%
     * participants) in its creators array.
     *
     * DataV2 + CreateMetadataAccountV3Args borsh layout (Token Metadata program).
     */
    private buildCreateMetadataV3Ix(p: {
        metadata: PublicKey; mint: PublicKey; mintAuthority: PublicKey; payer: PublicKey; updateAuthority: PublicKey;
        name: string; symbol: string; uri: string; sellerFeeBasisPoints: number;
        creators: Array<{ address: PublicKey; verified: boolean; share: number }>;
        collection?: PublicKey;
        /** Some(V1{size}) marks THIS mint as a sized collection parent. Undefined/null = None. */
        collectionDetailsV1Size?: number | null;
    }): TransactionInstruction {
        const borshStr = (s: string): Buffer => {
            const b = Buffer.from(s, 'utf8');
            const len = Buffer.alloc(4); len.writeUInt32LE(b.length, 0);
            return Buffer.concat([len, b]);
        };
        const parts: Buffer[] = [];
        parts.push(Buffer.from([33]));                                   // CreateMetadataAccountV3 discriminator
        parts.push(borshStr((p.name || '').slice(0, 32)));              // name (max 32)
        parts.push(borshStr((p.symbol || '').slice(0, 10)));           // symbol (max 10)
        parts.push(borshStr((p.uri || '').slice(0, 200)));            // uri (max 200)
        const fee = Buffer.alloc(2);
        fee.writeUInt16LE(Math.max(0, Math.min(10000, p.sellerFeeBasisPoints | 0)), 0);
        parts.push(fee);                                                // sellerFeeBasisPoints (u16)
        if (p.creators && p.creators.length) {                          // creators: Option<Vec<Creator>>
            parts.push(Buffer.from([1]));
            const cnt = Buffer.alloc(4); cnt.writeUInt32LE(p.creators.length, 0); parts.push(cnt);
            for (const c of p.creators) {
                parts.push(c.address.toBuffer());                       // pubkey (32)
                parts.push(Buffer.from([c.verified ? 1 : 0]));          // verified (bool)
                parts.push(Buffer.from([c.share & 0xff]));              // share (u8)
            }
        } else {
            parts.push(Buffer.from([0]));
        }
        if (p.collection) {                                             // collection: Option<Collection>
            parts.push(Buffer.from([1]));
            // verified=false here ALWAYS. Only the collection authority can flip this, via a
            // separate VerifySizedCollectionItem instruction. Writing true here would be a claim
            // the program never checked, and indexers would show an unverified item as verified.
            parts.push(Buffer.from([0]));                               // verified (bool)
            parts.push(p.collection.toBuffer());                        // key (pubkey)
        } else {
            parts.push(Buffer.from([0]));                               // collection: None
        }
        parts.push(Buffer.from([0]));                                   // uses: None
        parts.push(Buffer.from([1]));                                   // isMutable: true
        if (p.collectionDetailsV1Size !== undefined && p.collectionDetailsV1Size !== null) {
            parts.push(Buffer.from([1, 0]));                            // Some(CollectionDetails::V1)
            const szBuf = Buffer.alloc(8); szBuf.writeBigUInt64LE(BigInt(p.collectionDetailsV1Size), 0);
            parts.push(szBuf);                                          // size (u64)
        } else {
            parts.push(Buffer.from([0]));                               // collectionDetails: None
        }
        const data = Buffer.concat(parts);
        const keys = [
            { pubkey: p.metadata,        isSigner: false, isWritable: true },
            { pubkey: p.mint,            isSigner: false, isWritable: false },
            { pubkey: p.mintAuthority,   isSigner: true,  isWritable: false },
            { pubkey: p.payer,           isSigner: true,  isWritable: true },
            { pubkey: p.updateAuthority, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ];
        return new TransactionInstruction({ programId: TOKEN_METADATA_PROGRAM_ID, keys, data });
    }

    /**
     * Hand-built CreateMasterEditionV3 instruction (discriminator 17).
     *
     * This is what makes a token read as `NonFungible` rather than `Custom`. Metadata alone is not
     * enough: without a Master Edition, indexers and wallets classify the token as a plain SPL
     * token, which is exactly why 79 TOLA mints show under Tokens instead of Collectibles.
     *
     * maxSupply = Some(0) means no prints may ever be struck, so the 1/1 stays a 1/1.
     *
     * The layout and account order below were read from the installed
     * @metaplex-foundation/mpl-token-metadata generated builder, not from memory.
     *
     * NOTE: this instruction moves the mint authority to the edition PDA. That transfer is
     * inherent to creating a Master Edition and cannot be deferred to a later step.
     */
    private buildCreateMasterEditionV3Ix(p: {
        edition: PublicKey; mint: PublicKey; updateAuthority: PublicKey; mintAuthority: PublicKey;
        payer: PublicKey; metadata: PublicKey; maxSupply?: number;
    }): TransactionInstruction {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([17]));                                  // CreateMasterEditionV3
        parts.push(Buffer.from([1]));                                   // maxSupply: Some
        const max = Buffer.alloc(8);
        max.writeBigUInt64LE(BigInt(Math.max(0, p.maxSupply ?? 0)), 0);  // 0 = no prints
        parts.push(max);
        const keys = [
            { pubkey: p.edition,         isSigner: false, isWritable: true },
            { pubkey: p.mint,            isSigner: false, isWritable: true },
            { pubkey: p.updateAuthority, isSigner: true,  isWritable: false },
            { pubkey: p.mintAuthority,   isSigner: true,  isWritable: false },
            { pubkey: p.payer,           isSigner: true,  isWritable: true },
            { pubkey: p.metadata,        isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ];
        return new TransactionInstruction({ programId: TOKEN_METADATA_PROGRAM_ID, keys, data: Buffer.concat(parts) });
    }

    /**
     * Hand-built VerifySizedCollectionItem instruction (discriminator 30).
     *
     * Setting collection.key in the metadata only CLAIMS membership. Until the collection
     * authority signs this, `verified` stays false and marketplaces treat the item as
     * unaffiliated - which is indistinguishable from someone spoofing the collection.
     */
    private buildVerifySizedCollectionItemIx(p: {
        metadata: PublicKey; collectionAuthority: PublicKey; payer: PublicKey;
        collectionMint: PublicKey; collectionMetadata: PublicKey; collectionMasterEdition: PublicKey;
    }): TransactionInstruction {
        const keys = [
            { pubkey: p.metadata,               isSigner: false, isWritable: true },
            { pubkey: p.collectionAuthority,    isSigner: true,  isWritable: false },
            { pubkey: p.payer,                  isSigner: true,  isWritable: true },
            { pubkey: p.collectionMint,         isSigner: false, isWritable: false },
            { pubkey: p.collectionMetadata,     isSigner: false, isWritable: true },
            { pubkey: p.collectionMasterEdition, isSigner: false, isWritable: false },
        ];
        return new TransactionInstruction({
            programId: TOKEN_METADATA_PROGRAM_ID, keys, data: Buffer.from([30]),
        });
    }

    /**
     * Is this URI backed by content-addressed permanent storage?
     *
     * Accepts the native schemes and a SHORT ALLOWLIST of gateway hosts. Deliberately not
     * "any https URL containing /ipfs/": that would accept https://anything.example/ipfs/x, which
     * is an ordinary mutable web server wearing an IPFS-shaped path.
     *
     * The gateway forms are accepted because that is what the pinning APIs hand back, but the
     * canonical ipfs:// form is what should be STORED - a gateway can disappear, a CID cannot.
     */
    static isPermanentUri(uri: string): boolean {
        if (!uri) { return false; }
        if (/^ipfs:\/\/[A-Za-z0-9]{20,}/i.test(uri)) { return true; }
        if (/^ar:\/\/[A-Za-z0-9_-]{20,}/i.test(uri)) { return true; }
        const GATEWAYS = [
            'gateway.pinata.cloud', 'ipfs.io', 'cloudflare-ipfs.com',
            'nftstorage.link', 'dweb.link', 'w3s.link',
        ];
        try {
            const u = new URL(uri);
            if (u.protocol !== 'https:') { return false; }
            if (u.hostname === 'arweave.net') { return true; }
            // Some gateways are subdomain-scoped (<cid>.ipfs.dweb.link), so match the suffix too.
            const onGateway = GATEWAYS.some(g => u.hostname === g || u.hostname.endsWith('.' + g));
            return onGateway && /\/ipfs\/[A-Za-z0-9]{20,}/.test(u.pathname);
        } catch {
            return false;
        }
    }

    /**
     * Upgrade an EXISTING bare SPL mint into a standards-compliant NFT, in place.
     *
     * No new mint is created, nothing is burned, no ownership moves. The token address, its
     * transaction history and its current holder all survive untouched; what changes is that the
     * mint gains the metadata it should have had from the start.
     *
     * Every precondition is re-read FROM CHAIN immediately before submission rather than trusted
     * from the caller. A stale precondition is the whole risk here: minting twice cannot be undone.
     *
     * Simulation is mandatory and fail-closed. A simulation that errors, or that cannot be run at
     * all, aborts - an unsimulated transaction is never submitted.
     */
    /** Deterministic collection mint: seed-derived from the treasury, so its address and every
     *  downstream verify instruction are knowable before execution, with no extra keypair. */
    static readonly COLLECTION_SEED = 'TOLA-COLLECTION-V1';

    async collectionMintAddress(): Promise<PublicKey> {
        if (!this.treasuryKeypair) { throw new Error('signer unavailable'); }
        return PublicKey.createWithSeed(this.treasuryKeypair.publicKey, TOLANFTMintService.COLLECTION_SEED, TOKEN_PROGRAM_ID);
    }

    /**
     * Create THE canonical sized collection NFT (the one governed new mint). Narrow by
     * construction: seed-fixed address, refuses if the account already exists, dry-run default,
     * execution bound to the preview approval hash exactly like upgradeExistingMint.
     */
    async createCollectionNft(request: {
        name: string; uri: string; creator?: string;
        sellerFeeBasisPoints?: number; dryRun?: boolean; approvedHash?: string;
    }): Promise<any> {
        const bps = request.sellerFeeBasisPoints ?? IMMUTABLE_ROYALTY.BPS;
        if (bps !== IMMUTABLE_ROYALTY.BPS) {
            return { success: false, refused: 'royalty_mismatch', detail: `${bps} != ${IMMUTABLE_ROYALTY.BPS}` };
        }
        if (!TOLANFTMintService.isPermanentUri(request.uri)) {
            return { success: false, refused: 'uri_not_permanent', detail: request.uri };
        }
        if (!this.initialized || !this.treasuryKeypair) { return { success: false, refused: 'signer_unavailable' }; }

        const connection = this.getConnection();
        const treasury = this.treasuryKeypair.publicKey;
        const mint = await this.collectionMintAddress();
        const existing = await connection.getAccountInfo(mint);
        if (existing) {
            return { success: false, refused: 'collection_already_exists', detail: mint.toBase58() };
        }

        const creatorAddress = request.creator ? new PublicKey(request.creator) : treasury;
        const creatorIsSigner = creatorAddress.equals(treasury);
        const metadataAddress = this.getMetadataAddress(mint);
        const editionAddress = this.getMasterEditionAddress(mint);
        const ata = await getAssociatedTokenAddress(mint, treasury);

        const approvalSha = createHash('sha256').update(JSON.stringify({
            action: 'create_collection', seed: TOLANFTMintService.COLLECTION_SEED,
            mint: mint.toBase58(), name: request.name, uri: request.uri, symbol: 'TOLA',
            seller_fee_basis_points: bps, creator: creatorAddress.toBase58(),
            creator_verified: creatorIsSigner, update_authority: treasury.toBase58(),
            collection_details_v1_size: 0, max_supply: 0,
        })).digest('hex');
        if (!request.dryRun && request.approvedHash !== approvalSha) {
            return { success: false, refused: 'approval_hash_required_or_mismatch' };
        }

        const MINT_SPACE = 82;
        const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SPACE);
        const { createInitializeMintInstruction, createMintToInstruction } = await import('@solana/spl-token');

        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 160_000 }));
tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.min(1_000_000, Math.max(0, Number(process.env.PRIORITY_FEE_MICROLAMPORTS || 200000))) }));

        tx.add(SystemProgram.createAccountWithSeed({
            fromPubkey: treasury, newAccountPubkey: mint, basePubkey: treasury,
            seed: TOLANFTMintService.COLLECTION_SEED, lamports: mintRent, space: MINT_SPACE,
            programId: TOKEN_PROGRAM_ID,
        }));
        tx.add(createInitializeMintInstruction(mint, 0, treasury, treasury));
        tx.add(createAssociatedTokenAccountInstruction(treasury, ata, treasury, mint));
        tx.add(createMintToInstruction(mint, ata, treasury, 1));
        tx.add(this.buildCreateMetadataV3Ix({
            metadata: metadataAddress, mint, mintAuthority: treasury, payer: treasury, updateAuthority: treasury,
            name: request.name, symbol: 'TOLA', uri: request.uri, sellerFeeBasisPoints: bps,
            creators: [{ address: creatorAddress, verified: creatorIsSigner, share: 100 }],
            collectionDetailsV1Size: 0,
        }));
        tx.add(this.buildCreateMasterEditionV3Ix({
            edition: editionAddress, mint, updateAuthority: treasury, mintAuthority: treasury,
            payer: treasury, metadata: metadataAddress, maxSupply: 0,
        }));

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash; tx.feePayer = treasury;

        let sim;
        try { sim = await connection.simulateTransaction(tx, [this.treasuryKeypair]); }
        catch (e: any) { return { success: false, refused: 'simulation_unavailable', detail: e?.message || String(e) }; }
        if (sim.value.err) {
            return { success: false, refused: 'simulation_failed', detail: JSON.stringify(sim.value.err),
                simulation: { logs: sim.value.logs || [] } };
        }
        const simulation = { logs: sim.value.logs || [], unitsConsumed: sim.value.unitsConsumed };

        if (request.dryRun) {
            const message = tx.compileMessage();
            let feeLamports: number | null = null;
            try { feeLamports = (await connection.getFeeForMessage(message, 'confirmed')).value ?? null; } catch {}
            let rentLamports = mintRent;
            try {
                rentLamports += await connection.getMinimumBalanceForRentExemption(165);
                rentLamports += await connection.getMinimumBalanceForRentExemption(679);
                rentLamports += await connection.getMinimumBalanceForRentExemption(282);
            } catch {}
            return { success: true, refused: 'dry_run_only', simulation, preview: {
                collection_mint: mint.toBase58(), metadata_pda: metadataAddress.toBase58(),
                edition_pda: editionAddress.toBase58(), token_account: ata.toBase58(),
                message_sha256: createHash('sha256').update(message.serialize()).digest('hex'),
                approval_sha256: approvalSha, fee_lamports: feeLamports, rent_lamports: rentLamports,
                update_authority: treasury.toBase58(), fee_payer: treasury.toBase58(),
            } };
        }

        let signature: string;
        try {
            tx.sign(this.treasuryKeypair);
            signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
        } catch (e: any) { return { success: false, refused: 'submit_failed', detail: e?.message || String(e) }; }
        try {
            const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
            if (conf.value.err) { return { success: false, refused: 'transaction_failed', signature, detail: JSON.stringify(conf.value.err) }; }
        } catch { return { success: false, outcome_unknown: true, refused: 'confirmation_timeout', signature }; }
        return { success: true, signature, collection_mint: mint.toBase58(), simulation };
    }

    /** SetAndVerifySizedCollectionItem: stamps and verifies membership in the sized collection.
     *  The item update authority and the collection authority are both the treasury here, so a
     *  single signer suffices. */
    private buildSetAndVerifySizedCollectionItemIx(p: {
        metadata: PublicKey; collectionAuthority: PublicKey; payer: PublicKey; updateAuthority: PublicKey;
        collectionMint: PublicKey; collectionMetadata: PublicKey; collectionMasterEdition: PublicKey;
    }): TransactionInstruction {
        const keys = [
            { pubkey: p.metadata,                isSigner: false, isWritable: true },
            { pubkey: p.collectionAuthority,     isSigner: true,  isWritable: false },
            { pubkey: p.payer,                   isSigner: true,  isWritable: true },
            { pubkey: p.updateAuthority,         isSigner: false, isWritable: false },
            { pubkey: p.collectionMint,          isSigner: false, isWritable: false },
            { pubkey: p.collectionMetadata,      isSigner: false, isWritable: true },
            { pubkey: p.collectionMasterEdition, isSigner: false, isWritable: false },
        ];
        return new TransactionInstruction({
            programId: TOKEN_METADATA_PROGRAM_ID,
            keys, data: Buffer.from([32]),
        });
    }

    /** Verify one repaired item into the canonical collection. */
    async setAndVerifyCollectionItem(request: { mint: string; dryRun?: boolean; approvedHash?: string; }): Promise<any> {
        if (!this.initialized || !this.treasuryKeypair) { return { success: false, refused: 'signer_unavailable' }; }
        const connection = this.getConnection();
        const treasury = this.treasuryKeypair.publicKey;
        const itemMint = new PublicKey(request.mint);
        const collectionMint = await this.collectionMintAddress();

        const approvalSha = createHash('sha256').update(JSON.stringify({
            action: 'set_and_verify', mint: itemMint.toBase58(), collection: collectionMint.toBase58(),
            authority: treasury.toBase58(),
        })).digest('hex');
        if (!request.dryRun && request.approvedHash !== approvalSha) {
            return { success: false, refused: 'approval_hash_required_or_mismatch' };
        }

        const itemMetadata = this.getMetadataAddress(itemMint);
        const meta = await connection.getAccountInfo(itemMetadata);
        if (!meta) { return { success: false, refused: 'item_metadata_absent' }; }
        const collMeta = await connection.getAccountInfo(this.getMetadataAddress(collectionMint));
        const collectionReady = !!collMeta;

        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.min(1_000_000, Math.max(0, Number(process.env.PRIORITY_FEE_MICROLAMPORTS || 200000))) }));
        tx.add(this.buildSetAndVerifySizedCollectionItemIx({
            metadata: itemMetadata, collectionAuthority: treasury, payer: treasury, updateAuthority: treasury,
            collectionMint, collectionMetadata: this.getMetadataAddress(collectionMint),
            collectionMasterEdition: this.getMasterEditionAddress(collectionMint),
        }));
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash; tx.feePayer = treasury;

        let simulation: any = null; let simErr: any = null;
        try {
            const sim = await connection.simulateTransaction(tx, [this.treasuryKeypair]);
            if (sim.value.err) { simErr = sim.value.err; }
            simulation = { logs: (sim.value.logs || []).slice(-6), unitsConsumed: sim.value.unitsConsumed };
        } catch (e: any) { simErr = e?.message || String(e); }

        if (request.dryRun) {
            const message = tx.compileMessage();
            return { success: true, refused: 'dry_run_only',
                collection_ready: collectionReady,
                simulation, simulation_error: simErr ? JSON.stringify(simErr) : null,
                preview: { item_metadata: itemMetadata.toBase58(), collection_mint: collectionMint.toBase58(),
                    approval_sha256: approvalSha,
                    message_sha256: createHash('sha256').update(message.serialize()).digest('hex'),
                    fee_lamports: 5000 } };
        }
        if (!collectionReady) { return { success: false, refused: 'collection_absent' }; }
        if (simErr) { return { success: false, refused: 'simulation_failed', detail: JSON.stringify(simErr), simulation }; }

        let signature: string;
        try {
            tx.sign(this.treasuryKeypair);
            signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
        } catch (e: any) { return { success: false, refused: 'submit_failed', detail: e?.message || String(e) }; }
        try {
            const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
            if (conf.value.err) { return { success: false, refused: 'transaction_failed', signature, detail: JSON.stringify(conf.value.err) }; }
        } catch { return { success: false, outcome_unknown: true, refused: 'confirmation_timeout', signature }; }
        return { success: true, signature };
    }


    async upgradeExistingMint(request: {
        mint: string;
        name: string;
        uri: string;
        /**
         * Optional by Founder ruling (CANARY 50): no canonical TOLA collection mint exists yet,
         * and creating one would be creating another mint - the one thing this path must refuse.
         * When absent, metadata is written with collection: None and no verify instruction; the
         * canonical collection is added later via SetAndVerifySizedCollectionItem under its own
         * Founder authorization.
         */
        collectionMint?: string;
        /**
         * Public creator identity (Founder ruling: the operational signer is the fee payer and
         * authority, NEVER the public creator). verified is derived, not requested: true only
         * when the creator IS the signing treasury key, false otherwise - an unverified creator
         * claim is honest; a forged verified flag is impossible anyway (the chain would reject
         * it), so we never build one.
         */
        creator?: string;
        expectedOwner: string;
        sellerFeeBasisPoints?: number;
        dryRun?: boolean;
        /**
         * Required for execution. The sha256 of the transaction INVARIANTS returned by the
         * preview as approval_sha256. The raw message hash cannot serve here - recentBlockhash
         * is part of the message, so the executed message always differs from the previewed one.
         * Binding on the invariants means what the Founder approved is what runs, and a changed
         * name, URI, creator, collection or royalty invalidates the approval automatically.
         */
        approvedHash?: string;
    }): Promise<{
        success: boolean;
        refused?: string;
        detail?: string;
        signature?: string;
        simulation?: { logs: string[]; unitsConsumed?: number };
        preview?: {
            instructions: Array<{ index: number; program: string; kind: string }>;
            message_base64: string;
            message_sha256: string;
            approval_sha256: string;
            fee_lamports: number | null;
            rent_lamports: number;
            est_total_sol: number;
            creators: Array<{ address: string; verified: boolean; share: number }>;
            collection: string | null;
            update_authority: string;
            fee_payer: string;
        };
        outcome_unknown?: boolean;
    }> {
        // Request validation runs FIRST, before any check on runtime state.
        //
        // Ordering matters for more than tidiness: if the signer check came first, these gates
        // could only ever be exercised in an environment holding a live private key, which means
        // they could not be proven in CI at all. Validating the request on its own merits keeps
        // the refusals deterministic and testable without a key present.

        // The royalty is taken from the locked constant, never from the caller. A request that
        // disagrees is refused rather than quietly corrected, so a 2000-bps caller cannot pass.
        const bps = request.sellerFeeBasisPoints ?? IMMUTABLE_ROYALTY.BPS;
        if (bps !== IMMUTABLE_ROYALTY.BPS) {
            return { success: false, refused: 'royalty_mismatch', detail: `${bps} != ${IMMUTABLE_ROYALTY.BPS}` };
        }
        if (!TOLANFTMintService.isPermanentUri(request.uri)) {
            // Railway and WordPress URLs are mutable and have already 404'd in this system.
            return { success: false, refused: 'uri_not_permanent', detail: request.uri };
        }

        if (!this.initialized || !this.treasuryKeypair) {
            return { success: false, refused: 'signer_unavailable' };
        }

        const connection = this.getConnection();
        const mint = new PublicKey(request.mint);
        const collectionMint = request.collectionMint ? new PublicKey(request.collectionMint) : null;

        // The public creator identity. verified is DERIVED: only a creator who is also the
        // transaction signer can be marked verified - anything else the chain itself rejects.
        const creatorAddress = request.creator
            ? new PublicKey(request.creator)
            : this.treasuryKeypair.publicKey;
        const creatorIsSigner = creatorAddress.equals(this.treasuryKeypair.publicKey);

        // ---- preconditions, read from chain now ----
        const mintInfo = await connection.getParsedAccountInfo(mint);
        const parsed: any = (mintInfo.value?.data as any)?.parsed?.info;
        if (!parsed) { return { success: false, refused: 'mint_not_readable' }; }
        if (String(parsed.decimals) !== '0' || String(parsed.supply) !== '1') {
            return { success: false, refused: 'not_nft_shape', detail: `decimals=${parsed.decimals} supply=${parsed.supply}` };
        }
        if (!parsed.mintAuthority) {
            return { success: false, refused: 'mint_authority_burned' };
        }
        if (parsed.mintAuthority !== this.treasuryKeypair.publicKey.toBase58()) {
            return { success: false, refused: 'not_our_mint_authority', detail: parsed.mintAuthority };
        }

        const metadataAddress = this.getMetadataAddress(mint);
        const existing = await connection.getAccountInfo(metadataAddress);
        if (existing) {
            // Idempotency: already upgraded. Report it rather than writing over it.
            return { success: false, refused: 'metadata_already_exists', detail: metadataAddress.toBase58() };
        }

        const largest = await connection.getTokenLargestAccounts(mint);
        const holderAta = largest.value?.[0]?.address;
        if (!holderAta) { return { success: false, refused: 'no_token_account' }; }
        const holderInfo = await connection.getParsedAccountInfo(holderAta);
        const holder = ((holderInfo.value?.data as any)?.parsed?.info?.owner) || '';
        if (holder !== request.expectedOwner) {
            return { success: false, refused: 'owner_mismatch', detail: `${holder} != ${request.expectedOwner}` };
        }

        // ---- build ----
        const treasury = this.treasuryKeypair.publicKey;
        const editionAddress = this.getMasterEditionAddress(mint);
        const creators = [{ address: creatorAddress, verified: creatorIsSigner, share: 100 }];

        // The invariants the Founder approves. Everything that decides what this NFT permanently
        // becomes is in here; nothing volatile (blockhash, fees) is.
        const approvalSha = createHash('sha256').update(JSON.stringify({
            mint: request.mint, name: request.name, uri: request.uri, symbol: 'TOLA',
            seller_fee_basis_points: bps,
            creator: creatorAddress.toBase58(), creator_verified: creatorIsSigner,
            collection: collectionMint ? collectionMint.toBase58() : null,
            update_authority: treasury.toBase58(), max_supply: 0,
        })).digest('hex');

        if (!request.dryRun && request.approvedHash !== approvalSha) {
            return {
                success: false, refused: 'approval_hash_required_or_mismatch',
                detail: 'execution requires approved_hash equal to the preview approval_sha256',
            };
        }

        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 130_000 }));
tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.min(1_000_000, Math.max(0, Number(process.env.PRIORITY_FEE_MICROLAMPORTS || 200000))) }));

        tx.add(this.buildCreateMetadataV3Ix({
            metadata: metadataAddress, mint, mintAuthority: treasury, payer: treasury, updateAuthority: treasury,
            name: request.name, symbol: 'TOLA', uri: request.uri, sellerFeeBasisPoints: bps,
            creators,
            collection: collectionMint ?? undefined,
        }));
        tx.add(this.buildCreateMasterEditionV3Ix({
            edition: editionAddress, mint, updateAuthority: treasury, mintAuthority: treasury,
            payer: treasury, metadata: metadataAddress, maxSupply: 0,
        }));
        if (collectionMint) {
            tx.add(this.buildVerifySizedCollectionItemIx({
                metadata: metadataAddress, collectionAuthority: treasury, payer: treasury,
                collectionMint,
                collectionMetadata: this.getMetadataAddress(collectionMint),
                collectionMasterEdition: this.getMasterEditionAddress(collectionMint),
            }));
        }

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = treasury;

        // ---- simulate, fail closed ----
        let sim;
        try {
            sim = await connection.simulateTransaction(tx, [this.treasuryKeypair]);
        } catch (e: any) {
            return { success: false, refused: 'simulation_unavailable', detail: e?.message || String(e) };
        }
        if (sim.value.err) {
            return {
                success: false, refused: 'simulation_failed',
                detail: JSON.stringify(sim.value.err),
                simulation: { logs: sim.value.logs || [] },
            };
        }
        const simulation = { logs: sim.value.logs || [], unitsConsumed: sim.value.unitsConsumed };

        if (request.dryRun) {
            // FOUNDER SIGNING BOUNDARY: the preview is everything needed to approve the exact
            // transaction - the serialized message and its hash, every instruction in order, the
            // authorities, and the cost. Approval is given against message_sha256; the execute
            // call is refused unless it echoes the same hash, so what was approved is what runs.
            const message = tx.compileMessage();
            const messageB64 = message.serialize().toString('base64');
            const messageSha = createHash('sha256').update(message.serialize()).digest('hex');
            let feeLamports: number | null = null;
            try {
                feeLamports = (await connection.getFeeForMessage(message, 'confirmed')).value ?? null;
            } catch { /* fee estimate is advisory; rent is the dominant cost */ }
            // Rent exemption for the two accounts this transaction creates (fixed sizes).
            const METADATA_SIZE = 679, EDITION_SIZE = 282;
            let rentLamports = 0;
            try {
                rentLamports =
                    (await connection.getMinimumBalanceForRentExemption(METADATA_SIZE)) +
                    (await connection.getMinimumBalanceForRentExemption(EDITION_SIZE));
            } catch { /* reported as 0 only if the RPC refuses; the simulate above already passed */ }
            const kinds = ['SetComputeUnitLimit', 'CreateMetadataAccountV3', 'CreateMasterEditionV3', 'VerifySizedCollectionItem'];
            return {
                success: true, refused: 'dry_run_only', simulation,
                preview: {
                    instructions: tx.instructions.map((ix, i) => ({
                        index: i, program: ix.programId.toBase58(), kind: kinds[i] || 'unknown',
                    })),
                    message_base64: messageB64,
                    message_sha256: messageSha,
                    approval_sha256: approvalSha,
                    fee_lamports: feeLamports,
                    rent_lamports: rentLamports,
                    est_total_sol: ((feeLamports ?? 5000) + rentLamports) / 1_000_000_000,
                    creators: creators.map( c => ({ address: c.address.toBase58(), verified: c.verified, share: c.share }) ),
                    collection: collectionMint ? collectionMint.toBase58() : null,
                    update_authority: treasury.toBase58(),
                    fee_payer: treasury.toBase58(),
                },
            };
        }

        // ---- submit ----
        // The signature is captured BEFORE confirmation is awaited. A confirmation timeout on a
        // transaction whose signature we never recorded is unreconcilable, and blind retry after
        // one is how a duplicate gets created.
        let signature: string;
        try {
            tx.sign(this.treasuryKeypair);
            signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false, maxRetries: 0,
            });
        } catch (e: any) {
            return { success: false, refused: 'submit_failed', detail: e?.message || String(e) };
        }

        try {
            const conf = await connection.confirmTransaction(
                { signature, blockhash, lastValidBlockHeight }, 'confirmed');
            if (conf.value.err) {
                return { success: false, refused: 'transaction_failed', signature, detail: JSON.stringify(conf.value.err), simulation };
            }
        } catch (e: any) {
            // Timed out waiting. The transaction may or may not have landed; that is a question for
            // reconciliation against chain, never for a retry.
            return { success: false, outcome_unknown: true, refused: 'confirmation_timeout', signature, simulation };
        }

        return { success: true, signature, simulation };
    }

    /**
     * Mint a new NFT
     */
    // ===================================================================
    // CANONICAL USER-MINT PATHWAY (Founder directive 2026-08-31)
    //
    // Deterministic mint address from the idempotency key, Master Edition with
    // zero prints, verified membership in a canonical collection, fixed 500 bps,
    // creator verification DERIVED from the actual signer, permanent ipfs://|ar://
    // metadata with exact artwork SHA-256 binding. Repeated calls with the same
    // idempotency key converge on the SAME mint - a retry can finish an
    // interrupted mint but can never create a second NFT.
    // ===================================================================

    /**
     * Same key -> same seed -> same keypair -> same mint address, on every retry,
     * from any process. The secret keeps the mapping unforgeable: without it,
     * knowing a key reveals nothing and choosing a mint address is impossible.
     */
    private deriveUserMintKeypair(idempotencyKey: string): Keypair {
        const secret = process.env.MINT_IDEMPOTENCY_SECRET || '';
        if (Buffer.byteLength(secret, 'utf8') < 32) {
            throw new Error('MINT_IDEMPOTENCY_SECRET missing or shorter than 32 bytes - user minting is disabled (fail closed)');
        }
        if (secret === (process.env.WP_RAILWAY_SHARED_SECRET || '')) {
            throw new Error('MINT_IDEMPOTENCY_SECRET must be distinct from WP_RAILWAY_SHARED_SECRET');
        }
        const seed = createHash('sha256').update(`${secret}:${idempotencyKey}`).digest();
        return Keypair.fromSeed(seed);
    }

    private boundedPriorityFee(): number {
        return Math.min(1_000_000, Math.max(0, Number(process.env.PRIORITY_FEE_MICROLAMPORTS || 200000)));
    }

    private resolveCanonicalCollection(which: string): PublicKey {
        const envName = which === 'tola' ? 'TOLA_COLLECTION_MINT' : 'VORTEX_CREATOR_COLLECTION_MINT';
        const v = process.env[envName] || '';
        if (!v) { throw new Error(`${envName} is not installed - collection membership cannot be verified (fail closed)`); }
        return new PublicKey(v);
    }

    /**
     * Fetch the metadata JSON through independent gateways and prove the artwork binding.
     * Both gateways must return byte-identical content; the JSON must reference the exact
     * artwork SHA-256 and a permanent image URI. Any failure refuses the mint.
     */
    private async proveArtworkBinding(metadataUri: string, artworkSha256: string): Promise<{ ok: boolean; reason?: string }> {
        try {
            let urls: string[];
            if (metadataUri.startsWith('ipfs://')) {
                const cid = metadataUri.slice('ipfs://'.length);
                urls = [`https://gateway.pinata.cloud/ipfs/${cid}`, `https://ipfs.io/ipfs/${cid}`];
            } else if (metadataUri.startsWith('ar://')) {
                const tx = metadataUri.slice('ar://'.length);
                urls = [`https://arweave.net/${tx}`];
            } else {
                return { ok: false, reason: 'metadata_uri must be ipfs:// or ar://' };
            }
            const bodies: Buffer[] = [];
            for (const u of urls) {
                const r = await axios.get(u, { responseType: 'arraybuffer', timeout: 30000 });
                bodies.push(Buffer.from(r.data));
            }
            if (bodies.length === 2) {
                const h0 = createHash('sha256').update(bodies[0] as any).digest('hex');
                const h1 = createHash('sha256').update(bodies[1] as any).digest('hex');
                if (h0 !== h1) { return { ok: false, reason: 'gateways disagree on metadata content' }; }
            }
            const json = JSON.parse(bodies[0].toString('utf8'));
            const image = String(json.image || '');
            if (!/^(ipfs|ar):\/\//.test(image)) { return { ok: false, reason: 'metadata image is not a permanent ipfs:// or ar:// URI' }; }
            if (!JSON.stringify(json).toLowerCase().includes(artworkSha256.toLowerCase())) {
                return { ok: false, reason: 'metadata does not carry the declared artwork SHA-256' };
            }
            return { ok: true };
        } catch (e: any) {
            return { ok: false, reason: `metadata unreachable: ${e.message}` };
        }
    }

    /** Read the derived mint's on-chain state: the ground truth for idempotency and status. */
    async userMintStatus(idempotencyKey: string): Promise<{
        success: boolean; state: string; mint_address: string;
        metadata_pda?: string; edition_pda?: string; collection_verified?: boolean; error?: string;
    }> {
        try {
            const mintKp = this.deriveUserMintKeypair(idempotencyKey);
            const mint = mintKp.publicKey;
            const connection = this.getConnection();
            const info = await connection.getAccountInfo(mint);
            if (!info) {
                return { success: true, state: 'not_started', mint_address: mint.toBase58() };
            }
            const metadataPda = this.getMetadataAddress(mint);
            const editionPda = this.getMasterEditionAddress(mint);
            const metaInfo = await connection.getAccountInfo(metadataPda);
            if (!metaInfo) {
                // tx1 is atomic, so a derived mint without metadata means an outside write
                // landed on our derived address - stop and reconcile, never build on it.
                return { success: true, state: 'state_conflict', mint_address: mint.toBase58() };
            }
            const verified = this.readCollectionVerified(metaInfo.data);
            return {
                success: true,
                state: verified ? 'finalized' : 'awaiting_collection_verify',
                mint_address: mint.toBase58(),
                metadata_pda: metadataPda.toBase58(),
                edition_pda: editionPda.toBase58(),
                collection_verified: verified,
            };
        } catch (e: any) {
            return { success: false, state: 'error', mint_address: '', error: e.message };
        }
    }

    /** Sequential borsh walk to the collection struct's verified byte. */
    private readCollectionVerified(raw: Buffer): boolean {
        try {
            let o = 1 + 32 + 32;
            const str = () => { const len = raw.readUInt32LE(o); o += 4 + len; };
            str(); str(); str();                       // name, symbol, uri
            o += 2;                                     // seller fee
            if (raw[o] === 1) { o += 1; const n = raw.readUInt32LE(o); o += 4 + n * 34; } else { o += 1; }
            o += 2;                                     // primary_sale + is_mutable
            o += raw[o] === 1 ? 2 : 1;                  // edition_nonce
            o += raw[o] === 1 ? 2 : 1;                  // token_standard
            if (raw[o] !== 1) { return false; }         // collection: None
            return raw[o + 1] === 1;
        } catch { return false; }
    }

    /**
     * Execute (or resume) one canonical user mint. Fail-closed on every gate; the only
     * states this leaves behind are "nothing happened" and steps that are individually
     * complete and verifiable on chain.
     */
    async userMint(request: {
        idempotency_key: string;
        name: string;
        metadata_uri: string;
        artwork_sha256: string;
        recipient_wallet: string;
        collection: string;
        attribution_creator?: string;
        payment?: { currency?: string; state?: string };
        royalty_bps?: number;
        dry_run?: boolean;
    }): Promise<any> {
        if (!this.initialized || !this.treasuryKeypair) {
            return { success: false, code: 'SIGNER_UNAVAILABLE', error: 'Treasury signer not configured' };
        }
        const refuse = (code: string, error: string) => ({ success: false, code, error });

        // ------------------------- request law -------------------------
        const key = String(request.idempotency_key || '');
        if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
            return refuse('IDEMPOTENCY_KEY_INVALID', 'idempotency_key must be 16-128 chars of [A-Za-z0-9._:-]');
        }
        const name = String(request.name || '').trim();
        if (!name || name.length > 32) { return refuse('NAME_INVALID', 'name must be 1-32 characters'); }
        const uri = String(request.metadata_uri || '');
        if (!/^(ipfs|ar):\/\/[A-Za-z0-9_-]{20,}/.test(uri)) {
            return refuse('METADATA_NOT_PERMANENT', 'metadata_uri must be a native ipfs:// or ar:// URI - gateway and http forms are refused for user mints');
        }
        const artSha = String(request.artwork_sha256 || '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(artSha)) { return refuse('ARTWORK_SHA256_MISSING', 'artwork_sha256 must be a 64-hex SHA-256'); }
        if (request.royalty_bps !== undefined && Number(request.royalty_bps) !== IMMUTABLE_ROYALTY.BPS) {
            return refuse('ROYALTY_NOT_500', 'royalty is fixed at 500 bps and cannot be changed per mint');
        }
        const pay = request.payment || {};
        const currency = String(pay.currency || '').toLowerCase();
        const payState = String(pay.state || '').toLowerCase();
        if (currency.includes('tola') || payState.includes('tola')) {
            return refuse('TOLA_PAYMENT_REFUSED', 'TOLA is never a payment currency. Pay in USD or USDC, or use a subscription entitlement.');
        }
        const paid = (payState === 'paid' && (currency === 'usd' || currency === 'usdc'));
        const included = (payState === 'included');
        if (!paid && !included) {
            return refuse('PAYMENT_NOT_CONFIRMED', 'payment must be state=paid with currency usd|usdc, or state=included via subscription entitlement');
        }
        let recipient: PublicKey;
        try { recipient = new PublicKey(String(request.recipient_wallet || '')); }
        catch { return refuse('RECIPIENT_INVALID', 'recipient_wallet is not a valid Solana address'); }
        if (request.collection !== 'tola' && request.collection !== 'creator') {
            return refuse('COLLECTION_INVALID', 'collection must be "tola" or "creator"');
        }

        // ------------------------- derived state -------------------------
        let mintKp: Keypair; let collectionMint: PublicKey;
        try {
            mintKp = this.deriveUserMintKeypair(key);
            collectionMint = this.resolveCanonicalCollection(request.collection);
        } catch (e: any) {
            return refuse('MINT_CONFIG_MISSING', e.message);
        }
        const mint = mintKp.publicKey;
        const metadataPda = this.getMetadataAddress(mint);
        const editionPda = this.getMasterEditionAddress(mint);
        const collectionMetadata = this.getMetadataAddress(collectionMint);
        const collectionEdition = this.getMasterEditionAddress(collectionMint);
        const treasury = this.treasuryKeypair.publicKey;
        const connection = this.getConnection();
        const dryRun = request.dry_run !== false;

        // Idempotent resume: chain state decides what remains to be done.
        const existing = await connection.getAccountInfo(mint);
        let needCreate = !existing;
        if (existing) {
            const metaInfo = await connection.getAccountInfo(metadataPda);
            if (!metaInfo) {
                return refuse('USER_MINT_STATE_CONFLICT',
                    'the derived mint address exists without our metadata - reconcile before any further write');
            }
            if (this.readCollectionVerified(metaInfo.data)) {
                return {
                    success: true, already_finalized: true, state: 'finalized',
                    mint_address: mint.toBase58(), metadata_pda: metadataPda.toBase58(),
                    edition_pda: editionPda.toBase58(), collection_mint: collectionMint.toBase58(),
                    collection_verified: true, royalty_bps: IMMUTABLE_ROYALTY.BPS,
                    artwork_sha256: artSha, metadata_uri: uri,
                };
            }
        }

        // Artwork binding proven through independent gateways before anything is built.
        const binding = await this.proveArtworkBinding(uri, artSha);
        if (!binding.ok) { return refuse('NFT_VISUAL_BINDING_FAILED', binding.reason || 'binding unproven'); }

        // Honest creators: royalty wallet is verified ONLY when it is the actual signer.
        const royaltyWallet = new PublicKey(IMMUTABLE_ROYALTY.WALLET);
        const creators: Array<{ address: PublicKey; verified: boolean; share: number }> = [];
        if (request.attribution_creator) {
            try {
                const attr = new PublicKey(request.attribution_creator);
                if (!attr.equals(royaltyWallet)) { creators.push({ address: attr, verified: false, share: 0 }); }
            } catch { return refuse('ATTRIBUTION_INVALID', 'attribution_creator is not a valid Solana address'); }
        }
        creators.push({ address: royaltyWallet, verified: royaltyWallet.equals(treasury), share: 100 });

        const priorityFee = this.boundedPriorityFee();
        const results: any = {
            mint_address: mint.toBase58(), metadata_pda: metadataPda.toBase58(),
            edition_pda: editionPda.toBase58(), collection_mint: collectionMint.toBase58(),
            royalty_bps: IMMUTABLE_ROYALTY.BPS, artwork_sha256: artSha, metadata_uri: uri,
            recipient: recipient.toBase58(), dry_run: dryRun, signatures: {} as Record<string, string>,
        };

        const { createInitializeMintInstruction, createMintToInstruction } = await import('@solana/spl-token');
        const tokenAccount = await getAssociatedTokenAddress(mint, recipient);
        results.token_account = tokenAccount.toBase58();

        if (needCreate) {
            const mintRent = await connection.getMinimumBalanceForRentExemption(82);
            const tx1 = new Transaction();
            tx1.add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
                SystemProgram.createAccount({
                    fromPubkey: treasury, newAccountPubkey: mint, space: 82,
                    lamports: mintRent, programId: TOKEN_PROGRAM_ID,
                }),
                // Freeze authority is set to the treasury ONLY so CreateMasterEditionV3 can
                // move it (with the mint authority) to the edition PDA in this same atomic
                // transaction. After tx1 no key on this platform can freeze or mint again.
                createInitializeMintInstruction(mint, 0, treasury, treasury),
                createAssociatedTokenAccountInstruction(treasury, tokenAccount, recipient, mint),
                createMintToInstruction(mint, tokenAccount, treasury, 1),
                this.buildCreateMetadataV3Ix({
                    metadata: metadataPda, mint, mintAuthority: treasury, payer: treasury,
                    updateAuthority: treasury, name, symbol: 'VORTEX', uri,
                    sellerFeeBasisPoints: IMMUTABLE_ROYALTY.BPS, creators,
                    collection: collectionMint,
                }),
                this.buildCreateMasterEditionV3Ix({
                    edition: editionPda, mint, updateAuthority: treasury,
                    mintAuthority: treasury, payer: treasury, metadata: metadataPda, maxSupply: 0,
                }),
            );
            const bh1 = await connection.getLatestBlockhash('confirmed');
            tx1.recentBlockhash = bh1.blockhash;
            tx1.feePayer = treasury;

            const sim = await connection.simulateTransaction(tx1, [this.treasuryKeypair, mintKp]);
            if (sim.value.err) {
                return refuse('MINT_SIMULATION_FAILED', JSON.stringify(sim.value.err));
            }
            results.simulated = true;
            if (dryRun) {
                results.success = true; results.state = 'simulated_only';
                return results;
            }
            results.signatures.mint_tx = await sendAndConfirmTransaction(
                connection, tx1, [this.treasuryKeypair, mintKp], { commitment: 'confirmed' });
        } else if (dryRun) {
            results.success = true; results.state = 'simulated_only';
            results.note = 'mint exists; a live run would only verify collection membership';
            return results;
        }

        const tx2 = new Transaction();
        tx2.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 90000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
            this.buildVerifySizedCollectionItemIx({
                metadata: metadataPda, collectionAuthority: treasury, payer: treasury,
                collectionMint, collectionMetadata, collectionMasterEdition: collectionEdition,
            }),
        );
        const bh2 = await connection.getLatestBlockhash('confirmed');
        tx2.recentBlockhash = bh2.blockhash;
        tx2.feePayer = treasury;
        results.signatures.verify_tx = await sendAndConfirmTransaction(
            connection, tx2, [this.treasuryKeypair], { commitment: 'confirmed' });

        const finalMeta = await connection.getAccountInfo(metadataPda);
        results.collection_verified = finalMeta ? this.readCollectionVerified(finalMeta.data) : false;
        results.success = results.collection_verified === true;
        results.state = results.success ? 'finalized' : 'verify_unconfirmed';
        return results;
    }

    async mintNFT(request: NFTMintRequest): Promise<NFTMintResult> {
        if (!this.initialized || !this.treasuryKeypair) {
            return {
                success: false,
                error: 'Treasury wallet not configured'
            };
        }

        if (!request.name || !request.uri) {
            return {
                success: false,
                error: 'Name and URI are required'
            };
        }

        // ---------------------------------------------------------------
        // SOL balance pre-check (belt-and-braces alongside TreasuryMonitor)
        // When MINT_PAYMENT_MODE=SOL the treasury must have enough SOL to
        // cover rent + transaction fees.  No token transfers are performed.
        // ---------------------------------------------------------------
        if (MINT_PAYMENT_MODE === 'SOL') {
            try {
                const connection = this.getConnection();
                const lamports = await connection.getBalance(this.treasuryKeypair.publicKey);
                const solBalance = lamports / LAMPORTS_PER_SOL;
                if (solBalance < ESTIMATED_MINT_COST_SOL) {
                    logger.error('[NFT Service] Insufficient treasury SOL for mint', {
                        balance: solBalance,
                        required: ESTIMATED_MINT_COST_SOL
                    });
                    return {
                        success: false,
                        error: `Insufficient treasury SOL: ${solBalance.toFixed(4)} < ${ESTIMATED_MINT_COST_SOL}`
                    };
                }
                logger.info(`[NFT Service] Treasury SOL OK: ${solBalance.toFixed(4)} SOL (need ${ESTIMATED_MINT_COST_SOL})`);
            } catch (balErr: any) {
                logger.warn('[NFT Service] SOL balance check failed, proceeding anyway', { error: balErr.message });
            }
        }

        try {
            logger.info(`[NFT Service] Minting NFT: ${request.name}`);
            
            const connection = this.getConnection();
            
            // Generate new mint keypair
            const mintKeypair = Keypair.generate();
            const mintAddress = mintKeypair.publicKey;
            
            // Determine recipient (treasury by default)
            const recipient = request.recipient 
                ? new PublicKey(request.recipient) 
                : this.treasuryKeypair.publicKey;
            
            // Get PDAs
            const metadataAddress = this.getMetadataAddress(mintAddress);
            const masterEditionAddress = this.getMasterEditionAddress(mintAddress);
            
            // Get associated token account for recipient
            const tokenAccount = await getAssociatedTokenAddress(
                mintAddress,
                recipient
            );
            
            // Build transaction
            const transaction = new Transaction();
            
            // Add compute budget
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: CONFIG.computeUnits }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CONFIG.priorityFee })
            );
            
            // Calculate rent for mint account
            const mintRent = await connection.getMinimumBalanceForRentExemption(82);
            
            // Create mint account
            transaction.add(
                SystemProgram.createAccount({
                    fromPubkey: this.treasuryKeypair.publicKey,
                    newAccountPubkey: mintAddress,
                    space: 82,
                    lamports: mintRent,
                    programId: TOKEN_PROGRAM_ID
                })
            );
            
            // Initialize mint (0 decimals for NFT).
            // freezeAuthority = null: NO freeze authority is ever set, so the platform can
            // never freeze a holder's token. This preserves full transfer freedom /
            // non-custodial ownership (founder requirement 2026-06-18). mintAuthority stays
            // with the treasury only to attach metadata in this same tx.
            const { createInitializeMintInstruction } = await import('@solana/spl-token');
            transaction.add(
                createInitializeMintInstruction(
                    mintAddress,
                    0, // 0 decimals for NFT
                    this.treasuryKeypair.publicKey, // mint authority (needed to write metadata in-tx)
                    null                            // freeze authority REVOKED (no freezing ever)
                )
            );
            
            // Create associated token account
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    this.treasuryKeypair.publicKey,
                    tokenAccount,
                    recipient,
                    mintAddress
                )
            );
            
            // Mint 1 token to recipient
            const { createMintToInstruction } = await import('@solana/spl-token');
            transaction.add(
                createMintToInstruction(
                    mintAddress,
                    tokenAccount,
                    this.treasuryKeypair.publicKey,
                    1
                )
            );
            
            // Reconciled 5% model (founder-approved 2026-06-18):
            //   - 100% of the 5% royalty -> VORTEX royalty wallet (verified; it is the treasury signer).
            //   - The artist/creator (recipient), when distinct, is included as an ATTRIBUTION-ONLY
            //     creator (share=0, unverified) so on-chain attribution survives transfer while the
            //     full royalty still flows to VORTEX. Shares must sum to 100.
            // Metaplex limit: 5 creators.
            const VORTEX_WALLET = new PublicKey(IMMUTABLE_ROYALTY.WALLET);
            const creatorList: Array<{ address: PublicKey; verified: boolean; share: number }> = [];
            const recipientStr = recipient.toBase58();
            if (recipientStr !== IMMUTABLE_ROYALTY.WALLET) {
                // attribution-only creator entry for the asset's creator (no royalty share)
                creatorList.push({ address: recipient, verified: false, share: 0 });
            }
            creatorList.push({ address: VORTEX_WALLET, verified: true, share: 100 });
            const creators = creatorList;

            logger.info(`[NFT Service] Royalty: ${IMMUTABLE_ROYALTY.BPS} BPS (5% -> 100% VORTEX ${IMMUTABLE_ROYALTY.WALLET}); creator attribution=${recipientStr !== IMMUTABLE_ROYALTY.WALLET ? recipientStr : 'n/a'}`);
            
            // Create the Metaplex Token Metadata account (CreateMetadataAccountV3).
            // THIS WAS THE MISSING STEP: without it the mint is a bare SPL token
            // (no name/image/creators/royalty). Attaches name, image URI, the
            // creators array, and the locked 5% seller-fee royalty (100% VORTEX)
            // so each mint is a real, royalty-bearing, attributed NFT.
            transaction.add(
                this.buildCreateMetadataV3Ix({
                    metadata:        metadataAddress,
                    mint:            mintAddress,
                    mintAuthority:   this.treasuryKeypair.publicKey,
                    payer:           this.treasuryKeypair.publicKey,
                    updateAuthority: this.treasuryKeypair.publicKey,
                    name:            request.name,
                    symbol:          'TOLA',
                    uri:             request.uri,
                    sellerFeeBasisPoints: IMMUTABLE_ROYALTY.BPS, // locked 5% (500 bps); WP also sends 500 -> no ambiguity
                    creators:        creators.map(c => ({ address: c.address, verified: c.verified, share: c.share })),
                })
            );

            // Get recent blockhash
            const { blockhash } = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.treasuryKeypair.publicKey;
            
            // Sign transaction
            transaction.sign(this.treasuryKeypair, mintKeypair);
            
            // Send and confirm
            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [this.treasuryKeypair, mintKeypair],
                { commitment: 'confirmed' }
            );
            
            logger.info(`[NFT Service] NFT minted: ${mintAddress.toBase58()}`);
            
            // Track minted NFT
            this.mintedNFTs.push({
                mint_address: mintAddress.toBase58(),
                name: request.name,
                uri: request.uri,
                created_at: new Date(),
                owner: recipient.toBase58(),
                signature
            });
            this.totalMinted++;
            
            // Get fee
            let fee = 0;
            try {
                const txInfo = await connection.getTransaction(signature, { commitment: 'confirmed' });
                fee = (txInfo?.meta?.fee || 0) / LAMPORTS_PER_SOL;
            } catch (e) {}
            
            return {
                success: true,
                mint_address: mintAddress.toBase58(),
                metadata_address: metadataAddress.toBase58(),
                token_account: tokenAccount.toBase58(),
                signature,
                explorer_url: `https://solscan.io/token/${mintAddress.toBase58()}`,
                fee,
                payment_status: 'assumed_paid' // App-level fee (e.g. 10 USDC) handled by WordPress; on-chain fees paid in SOL by treasury
            };
            
        } catch (error: any) {
            logger.error('[NFT Service] Mint failed:', error);
            return {
                success: false,
                error: error.message || 'Mint failed'
            };
        }
    }

    /**
     * Transfer an NFT to a recipient
     */
    async transferNFT(request: NFTTransferRequest): Promise<NFTTransferResult> {
        if (!this.initialized || !this.treasuryKeypair) {
            return {
                success: false,
                error: 'Treasury wallet not configured'
            };
        }

        const { mint_address, recipient_wallet } = request;

        if (!mint_address || !recipient_wallet) {
            return {
                success: false,
                error: 'Mint address and recipient wallet are required'
            };
        }

        try {
            logger.info(`[NFT Service] Transferring NFT ${mint_address} to ${recipient_wallet}`);
            
            const connection = this.getConnection();
            const mintPubkey = new PublicKey(mint_address);
            const recipientPubkey = new PublicKey(recipient_wallet);
            
            // Get source token account
            const sourceTokenAccount = await getAssociatedTokenAddress(
                mintPubkey,
                this.treasuryKeypair.publicKey
            );
            
            // Get/create destination token account
            const destTokenAccount = await getAssociatedTokenAddress(
                mintPubkey,
                recipientPubkey
            );
            
            // Build transaction
            const transaction = new Transaction();
            
            // Add compute budget
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CONFIG.priorityFee })
            );
            
            // Check if destination account exists
            try {
                await connection.getAccountInfo(destTokenAccount);
            } catch (e) {
                // Create destination token account
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        this.treasuryKeypair.publicKey,
                        destTokenAccount,
                        recipientPubkey,
                        mintPubkey
                    )
                );
            }
            
            // Transfer instruction
            transaction.add(
                createTransferInstruction(
                    sourceTokenAccount,
                    destTokenAccount,
                    this.treasuryKeypair.publicKey,
                    1 // Transfer 1 NFT
                )
            );
            
            // Get blockhash and sign
            const { blockhash } = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.treasuryKeypair.publicKey;
            
            // Send and confirm
            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [this.treasuryKeypair],
                { commitment: 'confirmed' }
            );
            
            logger.info(`[NFT Service] NFT transferred: ${signature}`);
            
            return {
                success: true,
                signature,
                explorer_url: `https://solscan.io/tx/${signature}`
            };
            
        } catch (error: any) {
            logger.error('[NFT Service] Transfer failed:', error);
            return {
                success: false,
                error: error.message || 'Transfer failed'
            };
        }
    }

    /**
     * Get NFT information
     */
    async getNFT(mintAddress: string): Promise<NFTInfo> {
        try {
            const connection = this.getConnection();
            const mintPubkey = new PublicKey(mintAddress);
            
            // Check if mint exists
            const mintInfo = await getMint(connection, mintPubkey);
            
            if (!mintInfo) {
                return {
                    success: false,
                    error: 'NFT not found'
                };
            }
            
            // Get metadata address
            const metadataAddress = this.getMetadataAddress(mintPubkey);
            
            // Try to fetch on-chain metadata
            const metadataAccount = await connection.getAccountInfo(metadataAddress);
            
            let name = 'Unknown';
            let symbol = 'NFT';
            let uri = '';
            let creators: any[] = [];
            let sellerFeeBasisPoints = 0;
            
            if (metadataAccount) {
                // Parse metadata (simplified - full implementation needs Metaplex SDK)
                // The data is serialized using Borsh
                const data = metadataAccount.data;
                // Skip first 1 byte (key) + 32 bytes (update authority) + 32 bytes (mint)
                const nameLength = data[65];
                name = data.slice(66, 66 + nameLength).toString('utf8').replace(/\0/g, '');
            }
            
            // Get token largest accounts to find owner
            let owner = 'Unknown';
            try {
                const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
                if (largestAccounts.value.length > 0) {
                    const tokenAccount = await connection.getParsedAccountInfo(largestAccounts.value[0].address);
                    if (tokenAccount.value?.data && 'parsed' in tokenAccount.value.data) {
                        owner = tokenAccount.value.data.parsed.info.owner;
                    }
                }
            } catch (e) {}
            
            // Try to fetch metadata from URI
            let description = '';
            let image = '';
            let attributes: any[] = [];
            
            // Check local cache first
            const cachedNFT = this.mintedNFTs.find(n => n.mint_address === mintAddress);
            if (cachedNFT) {
                name = cachedNFT.name;
                uri = cachedNFT.uri;
                owner = cachedNFT.owner;
            }
            
            // Fetch external metadata if URI available
            if (uri) {
                try {
                    const response = await axios.get(uri, { timeout: 5000 });
                    const metadata = response.data;
                    description = metadata.description || '';
                    image = metadata.image || '';
                    attributes = metadata.attributes || [];
                } catch (e) {
                    // External metadata fetch failed
                }
            }
            
            return {
                success: true,
                mint_address: mintAddress,
                name,
                symbol,
                uri,
                description,
                image,
                owner,
                creators,
                seller_fee_basis_points: sellerFeeBasisPoints,
                attributes
            };
            
        } catch (error: any) {
            logger.error('[NFT Service] Get NFT failed:', error);
            return {
                success: false,
                error: error.message || 'Failed to get NFT'
            };
        }
    }

    /**
     * Get all NFTs minted by this service
     */
    getMintedNFTs(limit: number = 50): MintedNFT[] {
        return this.mintedNFTs.slice(-limit);
    }

    /**
     * Get minting statistics
     */
    getStats(): {
        total_minted: number;
        recent_mints: number;
    } {
        const oneHourAgo = new Date(Date.now() - 3600000);
        const recentMints = this.mintedNFTs.filter(n => n.created_at > oneHourAgo).length;
        
        return {
            total_minted: this.totalMinted,
            recent_mints: recentMints
        };
    }

    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return this.initialized && this.connections.length > 0;
    }

    /**
     * Get service health
     */
    async getHealth(): Promise<{
        healthy: boolean;
        treasury_configured: boolean;
        rpc_connections: number;
        total_minted: number;
        treasury_sol_balance?: number;
        royalty?: {
            bps: number;
            rate: number;
            wallet: string;
            immutable: boolean;
        };
    }> {
        let solBalance: number | undefined;
        
        if (this.treasuryKeypair) {
            try {
                const connection = this.getConnection();
                const balance = await connection.getBalance(this.treasuryKeypair.publicKey);
                solBalance = balance / LAMPORTS_PER_SOL;
            } catch (e) {}
        }
        
        return {
            healthy: this.isReady(),
            treasury_configured: !!this.treasuryKeypair,
            rpc_connections: this.connections.length,
            total_minted: this.totalMinted,
            treasury_sol_balance: solBalance,
            royalty: {
                bps: IMMUTABLE_ROYALTY.BPS,
                rate: IMMUTABLE_ROYALTY.RATE,
                wallet: IMMUTABLE_ROYALTY.WALLET,
                immutable: IMMUTABLE_ROYALTY.IMMUTABLE
            }
        };
    }

    /**
     * Get treasury address
     */
    getTreasuryAddress(): string | null {
        return this.treasuryKeypair?.publicKey.toBase58() || null;
    }
}
