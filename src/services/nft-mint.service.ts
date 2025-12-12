/**
 * NFT Minting Service - Metaplex Integration
 */

import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity, toMetaplexFile } from '@metaplex-foundation/js';
import axios from 'axios';
import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

const RPC_URL = process.env.RPC_URL || clusterApiUrl('mainnet-beta');
const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_PUBKEY || '';

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
    
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        this.db = new DatabaseService();
        
        // Note: In production, use a secure key management system
        // This is a placeholder - replace with actual Platform Wallet keypair
        const platformKeypair = Keypair.generate(); // REPLACE WITH ACTUAL KEYPAIR FROM SECURE STORAGE
        
        this.metaplex = Metaplex.make(this.connection)
            .use(keypairIdentity(platformKeypair))
            // bundlrStorage deprecated - using default storage
            
        logger.info('[NFT] Metaplex initialized');
    }
    
    /**
     * Mint NFT for WooCommerce product
     */
    async mintProductNFT(data: ProductNFTData): Promise<MintResult> {
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
                            address: PLATFORM_TREASURY,
                            share: 100
                        }
                    ]
                }
            };
            
            // Upload metadata
            const metadataOutput = await this.metaplex.nfts().uploadMetadata(metadata);
            const metadataUri = typeof metadataOutput === 'string' ? metadataOutput : metadataOutput.uri;
            
            logger.info(`[NFT] Metadata uploaded: ${metadataUri}`);
            
            // Mint NFT
            const { nft } = await this.metaplex.nfts().create({
                uri: metadataUri,
                name: data.name.substring(0, 32), // Solana name limit
                sellerFeeBasisPoints: 0,
                symbol: 'VORTEX'
            });
            
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

