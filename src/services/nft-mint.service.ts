/**
 * NFT Minting Service - Metaplex Integration
 * 
 * @version 4.0.0
 * @description Handles NFT minting for WooCommerce products on Solana
 */

import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity, toMetaplexFile } from '@metaplex-foundation/js';
import * as bs58 from 'bs58';
import axios from 'axios';
import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || clusterApiUrl('mainnet-beta');
const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_PUBKEY || process.env.TREASURY_WALLET_PUBLIC || '';

// IMMUTABLE ROYALTY CONFIGURATION - DO NOT MODIFY
const IMMUTABLE_ROYALTY_BPS = 500;  // 5% - LOCKED
const PLATFORM_ROYALTY_WALLET = process.env.PLATFORM_COMMISSION_WALLET || '6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g';

interface ProductNFTData {
    productId: number;
    name: string;
    description: string;
    imageUrl: string;
    productUrl: string;
    price: number;
    sku: string;
}

interface MintResult {
    mintAddress: string;
    signature: string;
    metadataUri: string;
    assetId: string;
}

export class NFTMintService {
    
    private connection: Connection;
    private metaplex: Metaplex;
    private db: DatabaseService;
    private initialized: boolean = false;
    
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        this.db = new DatabaseService();
        
        // Load platform keypair from environment (secure)
        const privateKeyBase58 = process.env.TREASURY_WALLET_PRIVATE;
        
        if (!privateKeyBase58) {
            logger.warn('[NFT] TREASURY_WALLET_PRIVATE not set - NFT minting will fail until configured');
            // Create dummy keypair for initialization (will fail on actual mint)
            const dummyKeypair = Keypair.generate();
            this.metaplex = Metaplex.make(this.connection)
                .use(keypairIdentity(dummyKeypair));
            this.initialized = false;
            logger.info('[NFT] Metaplex initialized in DEMO mode (no real minting)');
        } else {
            try {
                const privateKeyBytes = bs58.decode(privateKeyBase58);
                const platformKeypair = Keypair.fromSecretKey(privateKeyBytes);
                
                this.metaplex = Metaplex.make(this.connection)
                    .use(keypairIdentity(platformKeypair));
                    
                this.initialized = true;
                logger.info('[NFT] Metaplex initialized with treasury keypair - Real minting ready');
                logger.info(`[NFT] Treasury wallet: ${platformKeypair.publicKey.toString()}`);
            } catch (error) {
                logger.error('[NFT] Failed to load treasury keypair:', error);
                throw new Error('Invalid TREASURY_WALLET_PRIVATE - check Base58 encoding');
            }
        }
    }
    
    /**
     * Check if service is properly initialized for real minting
     */
    isReady(): boolean {
        return this.initialized;
    }
    
    /**
     * Get service status
     */
    getStatus(): { ready: boolean; treasury: string; rpc: string } {
        return {
            ready: this.initialized,
            treasury: PLATFORM_TREASURY || 'NOT_CONFIGURED',
            rpc: RPC_URL
        };
    }
    
    /**
     * Mint NFT for WooCommerce product
     */
    async mintProductNFT(data: ProductNFTData): Promise<MintResult> {
        // Check if service is ready for real minting
        if (!this.initialized) {
            logger.error('[NFT] Service not initialized - TREASURY_WALLET_PRIVATE not configured');
            throw new Error('NFT minting service not configured. Set TREASURY_WALLET_PRIVATE environment variable.');
        }
        
        try {
            logger.info(`[NFT] Minting NFT for product ${data.productId}: ${data.name}`);
            
            // Download product image
            const imageBuffer = await this.downloadImage(data.imageUrl);
            
            // Upload image to Arweave via Bundlr
            const imageFile = toMetaplexFile(imageBuffer, `product-${data.productId}.jpg`);
            const imageUri = await this.metaplex.storage().upload(imageFile);
            
            logger.info(`[NFT] Image uploaded: ${imageUri}`);
            
            // Create metadata JSON
            const metadata = {
                name: data.name,
                symbol: 'VORTEX',
                description: data.description,
                image: imageUri,
                external_url: data.productUrl,
                attributes: [
                    { trait_type: 'Product ID', value: data.productId.toString() },
                    { trait_type: 'SKU', value: data.sku },
                    { trait_type: 'Price USD', value: data.price.toString() },
                    { trait_type: 'Platform', value: 'Vortex Artec' },
                    { trait_type: 'Type', value: 'Product Asset' },
                    { trait_type: 'Minted At', value: new Date().toISOString() }
                ],
                properties: {
                    category: 'image',
                    files: [
                        {
                            uri: imageUri,
                            type: 'image/jpeg'
                        }
                    ],
                    creators: [
                        {
                            address: PLATFORM_ROYALTY_WALLET, // IMMUTABLE royalty recipient
                            share: 100
                        }
                    ]
                }
            };
            
            // Upload metadata
            const metadataOutput = await this.metaplex.nfts().uploadMetadata(metadata);
            const metadataUri = typeof metadataOutput === 'string' ? metadataOutput : metadataOutput.uri;
            
            logger.info(`[NFT] Metadata uploaded: ${metadataUri}`);
            
            // Mint NFT with IMMUTABLE 5% royalty
            const { nft } = await this.metaplex.nfts().create({
                uri: metadataUri,
                name: data.name.substring(0, 32), // Solana name limit
                sellerFeeBasisPoints: IMMUTABLE_ROYALTY_BPS, // 5% IMMUTABLE royalty
                symbol: 'VORTEX',
                creators: [
                    {
                        address: new PublicKey(PLATFORM_ROYALTY_WALLET),
                        share: 100,
                        authority: this.metaplex.identity()
                    }
                ]
            });
            
            logger.info(`[NFT] Royalty: ${IMMUTABLE_ROYALTY_BPS} BPS (5%) to ${PLATFORM_ROYALTY_WALLET}`);
            
            const mintAddress = nft.address.toString();
            const signature = nft.mint.address.toString(); // Transaction signature
            
            logger.info(`[NFT] Minted successfully: ${mintAddress}`);
            
            // Save to database
            const assetId = await this.db.saveProductAsset({
                productId: data.productId,
                nftMint: mintAddress,
                mintTx: signature,
                onChainUri: metadataUri,
                owner: PLATFORM_TREASURY,
                createdAt: new Date()
            });
            
            return {
                mintAddress,
                signature,
                metadataUri,
                assetId: assetId.toString()
            };
            
        } catch (error) {
            logger.error('[NFT] Mint error:', error);
            throw error;
        }
    }
    
    /**
     * Check if product already has NFT mint
     */
    async getProductMint(productId: number): Promise<string | null> {
        try {
            const asset = await this.db.getProductAsset(productId);
            return asset ? asset.nftMint : null;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Download product image
     */
    private async downloadImage(url: string): Promise<Buffer> {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data);
        } catch (error) {
            logger.error('[NFT] Image download error:', error);
            throw new Error('Failed to download product image');
        }
    }
}

