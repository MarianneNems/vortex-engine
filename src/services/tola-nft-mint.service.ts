/**
 * TOLA NFT Minting Service
 * 
 * Real Metaplex NFT minting on Solana blockchain
 * For TOLA incentive token distribution
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

export interface TOLANFTMintRequest {
    name: string;
    symbol: string;
    uri: string;
    sellerFeeBasisPoints: number;
    creators: Array<{
        address: string;
        share: number;
    }>;
    recipient_wallet?: string;  // User's wallet to receive the NFT after minting
    collection?: string;
    attributes?: Array<{
        trait_type: string;
        value: string;
    }>;
}

export interface TOLANFTMintResponse {
    success: boolean;
    nft_address?: string;
    mint_address?: string;
    metadata_address?: string;
    explorer_url?: string;
    transaction_signature?: string;
    error?: string;
}

export class TOLANFTMintService {
    private connection: Connection;
    private metaplex: Metaplex;
    private treasuryKeypair: Keypair;
    
    constructor() {
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');
        
        // Load treasury wallet
        const privateKeyBase58 = process.env.TREASURY_WALLET_PRIVATE;
        if (!privateKeyBase58) {
            throw new Error('TREASURY_WALLET_PRIVATE environment variable not set');
        }
        
        try {
            const privateKeyBytes = bs58.decode(privateKeyBase58);
            this.treasuryKeypair = Keypair.fromSecretKey(privateKeyBytes);
        } catch (error) {
            console.error('[TOLA NFT] Failed to load treasury keypair:', error);
            throw new Error('Invalid treasury wallet private key');
        }
        
        // Initialize Metaplex (without bundlr storage - uses default)
        this.metaplex = Metaplex.make(this.connection)
            .use(keypairIdentity(this.treasuryKeypair));
        
        console.log('[TOLA NFT] Service initialized - Real Metaplex minting ready');
    }
    
    /**
     * Mint REAL TOLA incentive NFT on Solana
     */
    async mintNFT(request: TOLANFTMintRequest): Promise<TOLANFTMintResponse> {
        try {
            console.log('[TOLA NFT] Starting real Metaplex mint:', {
                name: request.name,
                symbol: request.symbol,
                creators: request.creators.length
            });
            
            // Prepare creators array
            const creators = request.creators.map(c => ({
                address: new PublicKey(c.address),
                share: c.share
            }));
            
            // Mint NFT using Metaplex
            const { nft, response } = await this.metaplex.nfts().create({
                name: request.name,
                symbol: request.symbol,
                uri: request.uri,
                sellerFeeBasisPoints: request.sellerFeeBasisPoints,
                creators: creators,
                isMutable: true,
                maxSupply: 1
            });
            
            console.log('[TOLA NFT] ✅ NFT minted successfully:', {
                mint: nft.mint.address.toString(),
                metadata: nft.metadataAddress.toString(),
                signature: response.signature
            });
            
            return {
                success: true,
                nft_address: nft.address.toString(),
                mint_address: nft.mint.address.toString(),
                metadata_address: nft.metadataAddress.toString(),
                transaction_signature: response.signature,
                explorer_url: `https://solscan.io/token/${nft.mint.address.toString()}`
            };
            
        } catch (error: any) {
            console.error('[TOLA NFT] Mint error:', error);
            return {
                success: false,
                error: error.message || 'NFT minting failed'
            };
        }
    }
    
    /**
     * Upload metadata to Arweave via Bundlr
     */
    async uploadMetadata(metadata: {
        name: string;
        symbol: string;
        description: string;
        image: string;
        attributes?: Array<{ trait_type: string; value: string }>;
        properties?: {
            files: Array<{ uri: string; type: string }>;
            category: string;
        };
    }): Promise<string> {
        try {
            console.log('[TOLA NFT] Uploading metadata to Arweave...');
            
            const { uri } = await this.metaplex.nfts().uploadMetadata(metadata);
            
            console.log('[TOLA NFT] ✅ Metadata uploaded:', uri);
            
            return uri;
            
        } catch (error: any) {
            console.error('[TOLA NFT] Metadata upload error:', error);
            throw new Error('Metadata upload failed: ' + error.message);
        }
    }
    
    /**
     * Get NFT details
     */
    async getNFT(mintAddress: string) {
        try {
            const mint = new PublicKey(mintAddress);
            const nft = await this.metaplex.nfts().findByMint({ mintAddress: mint });
            
            return {
                success: true,
                nft: {
                    name: nft.name,
                    symbol: nft.symbol,
                    uri: nft.uri,
                    mint: nft.mint.address.toString(),
                    metadata: nft.metadataAddress.toString(),
                    creators: nft.creators.map(c => ({
                        address: c.address.toString(),
                        share: c.share
                    }))
                }
            };
        } catch (error: any) {
            console.error('[TOLA NFT] Get NFT error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Transfer NFT to user wallet
     */
    async transferNFT(mintAddress: string, toAddress: string) {
        try {
            const mint = new PublicKey(mintAddress);
            const to = new PublicKey(toAddress);
            
            const { response } = await this.metaplex.nfts().transfer({
                nftOrSft: { address: mint, tokenStandard: 0 } as any,
                toOwner: to
            });
            
            return {
                success: true,
                signature: response.signature,
                explorer_url: `https://solscan.io/tx/${response.signature}`
            };
        } catch (error: any) {
            console.error('[TOLA NFT] Transfer error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

