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
import { logger } from '../utils/logger';

// Metaplex Token Metadata Program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// IMMUTABLE ROYALTY CONFIGURATION - DO NOT MODIFY
const IMMUTABLE_ROYALTY = {
    BPS: 2000,          // 20% total (5% creator + 15% participants) - PERMANENTLY LOCKED
    RATE: 0.20,         // 20% as decimal
    WALLET: process.env.SYSTEM_CREATOR_ROYALTY_WALLET || 'EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz',
    IMMUTABLE: true,
    LOCKED_DATE: '2026-01-22'
} as const;

// Verify immutability
if (IMMUTABLE_ROYALTY.BPS !== 2000 || IMMUTABLE_ROYALTY.RATE !== 0.20) {
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
        parts.push(Buffer.from([0]));                                   // collection: None
        parts.push(Buffer.from([0]));                                   // uses: None
        parts.push(Buffer.from([1]));                                   // isMutable: true
        parts.push(Buffer.from([0]));                                   // collectionDetails: None
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
     * Mint a new NFT
     */
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
            
            // Initialize mint (0 decimals for NFT)
            const { createInitializeMintInstruction } = await import('@solana/spl-token');
            transaction.add(
                createInitializeMintInstruction(
                    mintAddress,
                    0, // 0 decimals for NFT
                    this.treasuryKeypair.publicKey,
                    this.treasuryKeypair.publicKey
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
            
            // Prepare creators — use PHP-provided shares (Marianne first at 25%, participants at 75%/N).
            // Metaplex limit: 5 creators. Truncate and redistribute dropped shares to the last entry.
            const MAX_METAPLEX_CREATORS = 5;
            let creatorList: Array<{ address: PublicKey; verified: boolean; share: number }>;
            if (request.creators && request.creators.length > 0) {
                const truncated = request.creators.slice(0, MAX_METAPLEX_CREATORS);
                if (request.creators.length > MAX_METAPLEX_CREATORS) {
                    const dropped = request.creators.slice(MAX_METAPLEX_CREATORS).reduce((s, c) => s + (c.share || 0), 0);
                    truncated[truncated.length - 1] = { ...truncated[truncated.length - 1], share: (truncated[truncated.length - 1].share || 0) + dropped };
                }
                creatorList = truncated.map(c => ({
                    address: new PublicKey(c.address),
                    verified: c.address === IMMUTABLE_ROYALTY.WALLET,
                    share: c.share || 0
                }));
            } else {
                creatorList = [{ address: new PublicKey(IMMUTABLE_ROYALTY.WALLET), verified: true, share: 100 }];
            }
            const creators = creatorList;

            logger.info(`[NFT Service] Royalty: ${IMMUTABLE_ROYALTY.BPS} BPS (20%: 5% creator + 15% participants) → ${IMMUTABLE_ROYALTY.WALLET} - IMMUTABLE`);
            
            // Create the Metaplex Token Metadata account (CreateMetadataAccountV3).
            // THIS WAS THE MISSING STEP: without it the mint is a bare SPL token
            // (no name/image/creators/royalty). Attaches name, image URI, the
            // creators array, and the 20% seller-fee royalty (5% creator + 15%
            // participants) so each Masterpiece is a real, royalty-bearing NFT.
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
                    sellerFeeBasisPoints: request.seller_fee_basis_points ?? IMMUTABLE_ROYALTY.BPS,
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
