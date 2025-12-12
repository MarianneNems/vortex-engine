/**
 * Daily Asset Service - Bundle today's products into single NFT
 */

import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';
import { DatabaseService } from './database.service';
import { WooCommerceService } from './woocommerce.service';
import { logger } from '../utils/logger';

const RPC_URL = process.env.RPC_URL || clusterApiUrl('mainnet-beta');
const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_PUBKEY || '';

interface DailyBundle {
    day: string; // YYYY-MM-DD
    bundleMint: string;
    bundleTx: string;
    componentMints: string[];
    sku: string;
    productCount: number;
    totalValue: number;
    createdAt: Date;
}

export class DailyAssetService {
    
    private connection: Connection;
    private metaplex: Metaplex;
    private db: DatabaseService;
    private wooService: WooCommerceService;
    
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        this.db = new DatabaseService();
        this.wooService = new WooCommerceService();
        
        // Platform keypair (secure storage in production)
        const platformKeypair = Keypair.generate(); // REPLACE WITH ACTUAL KEYPAIR
        
        this.metaplex = Metaplex.make(this.connection)
            .use(keypairIdentity(platformKeypair))
            // bundlrStorage deprecated - using default storage
    }
    
    /**
     * Create today's daily bundle NFT
     */
    async createDailyBundle(): Promise<DailyBundle> {
        try {
            const today = this.getTodayString();
            logger.info(`[DAILY ASSET] Creating bundle for ${today}...`);
            
            // Check if today's bundle already exists
            const existing = await this.db.getDailyBundle(today);
            if (existing) {
                logger.info(`[DAILY ASSET] Bundle already exists for ${today}`);
                return existing;
            }
            
            // Get all products published today with NFT mints
            const products = await this.db.getTodayProductAssets();
            
            if (products.length === 0) {
                throw new Error('No products with NFTs found for today');
            }
            
            const componentMints = products.map(p => p.nftMint);
            const totalValue = products.reduce((sum, p) => sum + (p.price || 0), 0);
            
            logger.info(`[DAILY ASSET] Bundling ${products.length} products, total value: $${totalValue}`);
            
            // Create bundle metadata
            const metadata = {
                name: `Vortex Daily Platform Asset ${today}`,
                symbol: 'VORTEX-DAILY',
                description: `Grouped daily platform asset containing ${products.length} products published on ${today}`,
                image: products[0]?.imageUrl || '',
                external_url: `${process.env.WOO_BASE_URL}/marketplace`,
                attributes: [
                    { trait_type: 'Bundle Date', value: today },
                    { trait_type: 'Product Count', value: products.length.toString() },
                    { trait_type: 'Total Value USD', value: totalValue.toString() },
                    { trait_type: 'Platform', value: 'Vortex Artec' },
                    { trait_type: 'Type', value: 'Daily Bundle' }
                ],
                properties: {
                    category: 'bundle',
                    files: products.map(p => ({
                        uri: p.onChainUri,
                        type: 'product'
                    })),
                    components: componentMints.map((mint, idx) => ({
                        mint,
                        productId: products[idx].productId,
                        name: products[idx].name
                    }))
                }
            };
            
            // Upload metadata
            const metadataUri = await this.metaplex.nfts().uploadMetadata(metadata);
            
            logger.info(`[DAILY ASSET] Metadata uploaded: ${metadataUri}`);
            
            // Mint bundle NFT
            const { nft } = await this.metaplex.nfts().create({
                uri: metadataUri,
                name: `VORTEX ${today}`,
                sellerFeeBasisPoints: 0,
                symbol: 'VXDAILY'
            });
            
            const bundleMint = nft.address.toString();
            const bundleTx = nft.mint.address.toString();
            
            logger.info(`[DAILY ASSET] Bundle minted: ${bundleMint}`);
            
            // Save to database
            const bundle: DailyBundle = {
                day: today,
                bundleMint,
                bundleTx,
                componentMints,
                sku: `DAILY-${today.replace(/-/g, '')}`,
                productCount: products.length,
                totalValue,
                createdAt: new Date()
            };
            
            await this.db.saveDailyBundle(bundle);
            
            logger.info(`[DAILY ASSET] Bundle saved to database`);
            
            return bundle;
            
        } catch (error) {
            logger.error('[DAILY ASSET] Create bundle error:', error);
            throw error;
        }
    }
    
    /**
     * Get today's bundle
     */
    async getTodayBundle(): Promise<DailyBundle | null> {
        try {
            const today = this.getTodayString();
            return await this.db.getDailyBundle(today);
        } catch (error) {
            logger.error('[DAILY ASSET] Get today bundle error:', error);
            return null;
        }
    }
    
    /**
     * Get all products with NFT status
     */
    async getProductsWithNFTs(): Promise<any[]> {
        try {
            return await this.db.getAllProductAssets();
        } catch (error) {
            logger.error('[DAILY ASSET] Get products error:', error);
            return [];
        }
    }
    
    /**
     * Get today's date string (YYYY-MM-DD)
     */
    private getTodayString(): string {
        const now = new Date();
        return now.toISOString().split('T')[0];
    }
}

