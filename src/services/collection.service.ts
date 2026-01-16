/**
 * NFT Collection Service - Production Grade
 * Manages NFT collections comparable to OpenSea, Foundation, SuperRare
 * 
 * Features:
 * - Collection creation and management
 * - Verified collection support
 * - Collection statistics and analytics
 * - Floor price tracking
 * - Volume and sales metrics
 * - Collection-level royalties
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
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress
} from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';
import { logger } from '../utils/logger';

// Metaplex Token Metadata Program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Collection Categories
export type CollectionCategory = 
    | 'art' 
    | 'photography' 
    | 'music' 
    | 'video' 
    | 'collectibles' 
    | 'gaming' 
    | 'virtual-worlds'
    | 'sports'
    | 'utility';

export interface CollectionCreator {
    address: string;
    share: number;
    verified: boolean;
    name?: string;
    profile_image?: string;
}

export interface CollectionStats {
    floor_price: number;
    floor_price_currency: string;
    total_volume: number;
    volume_24h: number;
    volume_7d: number;
    volume_30d: number;
    sales_count: number;
    sales_24h: number;
    unique_owners: number;
    listed_count: number;
    avg_price_24h: number;
    market_cap: number;
}

export interface Collection {
    id: string;
    name: string;
    symbol: string;
    description: string;
    image: string;
    banner_image?: string;
    external_url?: string;
    
    // On-chain data
    mint_address?: string;
    metadata_address?: string;
    update_authority?: string;
    
    // Creators and royalties
    creators: CollectionCreator[];
    seller_fee_basis_points: number;
    
    // Categorization
    category: CollectionCategory;
    tags: string[];
    
    // Verification
    is_verified: boolean;
    verified_at?: Date;
    
    // Stats
    total_supply: number;
    max_supply?: number;
    minted_count: number;
    stats: CollectionStats;
    
    // Social
    twitter?: string;
    discord?: string;
    website?: string;
    
    // Timestamps
    created_at: Date;
    updated_at: Date;
    
    // Featured/trending
    is_featured: boolean;
    trending_score: number;
}

export interface CreateCollectionRequest {
    name: string;
    symbol: string;
    description: string;
    image: string;
    banner_image?: string;
    external_url?: string;
    category: CollectionCategory;
    tags?: string[];
    creators: Array<{
        address: string;
        share: number;
    }>;
    seller_fee_basis_points?: number;
    max_supply?: number;
    twitter?: string;
    discord?: string;
    website?: string;
}

export interface CollectionNFT {
    mint_address: string;
    name: string;
    image: string;
    rank?: number;
    rarity_score?: number;
    price?: number;
    listed: boolean;
    owner: string;
    attributes: Array<{ trait_type: string; value: string | number }>;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export class CollectionService {
    private connection: Connection;
    private treasuryKeypair: Keypair | null = null;
    private collections: Map<string, Collection> = new Map();
    private collectionNFTs: Map<string, CollectionNFT[]> = new Map();
    private cache: Map<string, CacheEntry<any>> = new Map();
    private initialized: boolean = false;

    private readonly CACHE_TTL = 60000; // 1 minute

    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        
        const privateKey = process.env.TREASURY_WALLET_PRIVATE;
        if (privateKey) {
            try {
                this.treasuryKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
                this.initialized = true;
                logger.info('[Collection Service] Initialized');
            } catch (e: any) {
                logger.error('[Collection Service] Invalid treasury key:', e.message);
            }
        }

        // Cleanup cache periodically
        setInterval(() => this.cleanupCache(), this.CACHE_TTL);
    }

    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.CACHE_TTL) {
                this.cache.delete(key);
            }
        }
    }

    private getCached<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
            return entry.data as T;
        }
        return null;
    }

    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    /**
     * Create a new NFT collection
     */
    async createCollection(request: CreateCollectionRequest): Promise<{
        success: boolean;
        collection?: Collection;
        mint_address?: string;
        signature?: string;
        error?: string;
    }> {
        try {
            if (!this.initialized || !this.treasuryKeypair) {
                return { success: false, error: 'Service not initialized' };
            }

            // Validate request
            if (!request.name || request.name.length > 32) {
                return { success: false, error: 'Name is required and must be 32 characters or less' };
            }
            if (!request.symbol || request.symbol.length > 10) {
                return { success: false, error: 'Symbol is required and must be 10 characters or less' };
            }
            if (!request.image) {
                return { success: false, error: 'Image URI is required' };
            }

            logger.info(`[Collection] Creating: ${request.name}`);

            // Generate collection mint
            const collectionMint = Keypair.generate();
            
            // Create collection ID
            const collectionId = `COL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            // Build creators array
            const creators: CollectionCreator[] = request.creators.map(c => ({
                address: c.address,
                share: c.share,
                verified: c.address === this.treasuryKeypair!.publicKey.toBase58()
            }));

            // Initialize stats
            const stats: CollectionStats = {
                floor_price: 0,
                floor_price_currency: 'SOL',
                total_volume: 0,
                volume_24h: 0,
                volume_7d: 0,
                volume_30d: 0,
                sales_count: 0,
                sales_24h: 0,
                unique_owners: 0,
                listed_count: 0,
                avg_price_24h: 0,
                market_cap: 0
            };

            // Create collection object
            const collection: Collection = {
                id: collectionId,
                name: request.name,
                symbol: request.symbol,
                description: request.description,
                image: request.image,
                banner_image: request.banner_image,
                external_url: request.external_url,
                mint_address: collectionMint.publicKey.toBase58(),
                update_authority: this.treasuryKeypair.publicKey.toBase58(),
                creators,
                seller_fee_basis_points: request.seller_fee_basis_points || 500,
                category: request.category,
                tags: request.tags || [],
                is_verified: false,
                total_supply: 0,
                max_supply: request.max_supply,
                minted_count: 0,
                stats,
                twitter: request.twitter,
                discord: request.discord,
                website: request.website,
                created_at: new Date(),
                updated_at: new Date(),
                is_featured: false,
                trending_score: 0
            };

            // Store collection
            this.collections.set(collectionId, collection);
            this.collectionNFTs.set(collectionId, []);

            logger.info(`[Collection] Created: ${collectionId} (${request.name})`);

            return {
                success: true,
                collection,
                mint_address: collectionMint.publicKey.toBase58()
            };

        } catch (error: any) {
            logger.error('[Collection] Create failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get collection by ID
     */
    async getCollection(collectionId: string): Promise<Collection | null> {
        return this.collections.get(collectionId) || null;
    }

    /**
     * Get collection by mint address
     */
    async getCollectionByMint(mintAddress: string): Promise<Collection | null> {
        for (const collection of this.collections.values()) {
            if (collection.mint_address === mintAddress) {
                return collection;
            }
        }
        return null;
    }

    /**
     * List all collections with filtering and sorting
     */
    async listCollections(options: {
        category?: CollectionCategory;
        verified_only?: boolean;
        sort_by?: 'volume' | 'floor_price' | 'created' | 'trending';
        sort_order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
        search?: string;
    } = {}): Promise<{
        collections: Collection[];
        total: number;
        has_more: boolean;
    }> {
        let collections = Array.from(this.collections.values());

        // Filter by category
        if (options.category) {
            collections = collections.filter(c => c.category === options.category);
        }

        // Filter verified only
        if (options.verified_only) {
            collections = collections.filter(c => c.is_verified);
        }

        // Search
        if (options.search) {
            const search = options.search.toLowerCase();
            collections = collections.filter(c => 
                c.name.toLowerCase().includes(search) ||
                c.description.toLowerCase().includes(search) ||
                c.tags.some(t => t.toLowerCase().includes(search))
            );
        }

        // Sort
        const sortOrder = options.sort_order === 'asc' ? 1 : -1;
        switch (options.sort_by) {
            case 'volume':
                collections.sort((a, b) => (b.stats.total_volume - a.stats.total_volume) * sortOrder);
                break;
            case 'floor_price':
                collections.sort((a, b) => (b.stats.floor_price - a.stats.floor_price) * sortOrder);
                break;
            case 'trending':
                collections.sort((a, b) => (b.trending_score - a.trending_score) * sortOrder);
                break;
            case 'created':
            default:
                collections.sort((a, b) => (b.created_at.getTime() - a.created_at.getTime()) * sortOrder);
        }

        const total = collections.length;
        const limit = options.limit || 20;
        const offset = options.offset || 0;

        collections = collections.slice(offset, offset + limit);

        return {
            collections,
            total,
            has_more: offset + collections.length < total
        };
    }

    /**
     * Get trending collections
     */
    async getTrendingCollections(limit: number = 10): Promise<Collection[]> {
        const cacheKey = `trending_${limit}`;
        const cached = this.getCached<Collection[]>(cacheKey);
        if (cached) return cached;

        const result = await this.listCollections({
            sort_by: 'trending',
            sort_order: 'desc',
            limit
        });

        this.setCache(cacheKey, result.collections);
        return result.collections;
    }

    /**
     * Get top collections by volume
     */
    async getTopCollections(period: '24h' | '7d' | '30d' | 'all' = '24h', limit: number = 10): Promise<Collection[]> {
        let collections = Array.from(this.collections.values());

        switch (period) {
            case '24h':
                collections.sort((a, b) => b.stats.volume_24h - a.stats.volume_24h);
                break;
            case '7d':
                collections.sort((a, b) => b.stats.volume_7d - a.stats.volume_7d);
                break;
            case '30d':
                collections.sort((a, b) => b.stats.volume_30d - a.stats.volume_30d);
                break;
            case 'all':
            default:
                collections.sort((a, b) => b.stats.total_volume - a.stats.total_volume);
        }

        return collections.slice(0, limit);
    }

    /**
     * Add NFT to collection
     */
    async addNFTToCollection(collectionId: string, nft: CollectionNFT): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) return false;

        const nfts = this.collectionNFTs.get(collectionId) || [];
        
        // Check if already exists
        if (nfts.some(n => n.mint_address === nft.mint_address)) {
            return false;
        }

        nfts.push(nft);
        this.collectionNFTs.set(collectionId, nfts);

        // Update collection stats
        collection.minted_count = nfts.length;
        collection.total_supply = nfts.length;
        collection.stats.unique_owners = new Set(nfts.map(n => n.owner)).size;
        collection.stats.listed_count = nfts.filter(n => n.listed).length;
        
        // Calculate floor price
        const listedPrices = nfts.filter(n => n.listed && n.price).map(n => n.price!);
        if (listedPrices.length > 0) {
            collection.stats.floor_price = Math.min(...listedPrices);
        }

        collection.updated_at = new Date();
        
        return true;
    }

    /**
     * Get NFTs in collection
     */
    async getCollectionNFTs(collectionId: string, options: {
        sort_by?: 'price' | 'rank' | 'recent';
        listed_only?: boolean;
        limit?: number;
        offset?: number;
        trait_filters?: Array<{ trait_type: string; value: string }>;
    } = {}): Promise<{
        nfts: CollectionNFT[];
        total: number;
        has_more: boolean;
    }> {
        let nfts = this.collectionNFTs.get(collectionId) || [];

        // Filter listed only
        if (options.listed_only) {
            nfts = nfts.filter(n => n.listed);
        }

        // Filter by traits
        if (options.trait_filters && options.trait_filters.length > 0) {
            nfts = nfts.filter(nft => 
                options.trait_filters!.every(filter =>
                    nft.attributes.some(attr => 
                        attr.trait_type === filter.trait_type && 
                        String(attr.value) === filter.value
                    )
                )
            );
        }

        // Sort
        switch (options.sort_by) {
            case 'price':
                nfts.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
                break;
            case 'rank':
                nfts.sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
                break;
            case 'recent':
            default:
                // Keep original order (most recent)
                break;
        }

        const total = nfts.length;
        const limit = options.limit || 20;
        const offset = options.offset || 0;

        nfts = nfts.slice(offset, offset + limit);

        return {
            nfts,
            total,
            has_more: offset + nfts.length < total
        };
    }

    /**
     * Update collection stats after a sale
     */
    async recordSale(collectionId: string, price: number, currency: string = 'SOL'): Promise<void> {
        const collection = this.collections.get(collectionId);
        if (!collection) return;

        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        collection.stats.total_volume += price;
        collection.stats.volume_24h += price;
        collection.stats.volume_7d += price;
        collection.stats.volume_30d += price;
        collection.stats.sales_count++;
        collection.stats.sales_24h++;

        // Update average price
        if (collection.stats.sales_24h > 0) {
            collection.stats.avg_price_24h = collection.stats.volume_24h / collection.stats.sales_24h;
        }

        // Update market cap estimate
        collection.stats.market_cap = collection.stats.floor_price * collection.total_supply;

        // Update trending score (simplified algorithm)
        collection.trending_score = 
            (collection.stats.volume_24h * 10) + 
            (collection.stats.sales_24h * 5) + 
            (collection.is_verified ? 100 : 0);

        collection.updated_at = new Date();

        logger.info(`[Collection] Sale recorded: ${collectionId}, ${price} ${currency}`);
    }

    /**
     * Verify a collection
     */
    async verifyCollection(collectionId: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) return false;

        collection.is_verified = true;
        collection.verified_at = new Date();
        collection.updated_at = new Date();
        collection.trending_score += 100;

        logger.info(`[Collection] Verified: ${collectionId}`);
        return true;
    }

    /**
     * Feature a collection
     */
    async featureCollection(collectionId: string, featured: boolean = true): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) return false;

        collection.is_featured = featured;
        collection.updated_at = new Date();

        return true;
    }

    /**
     * Get collection analytics
     */
    async getCollectionAnalytics(collectionId: string): Promise<{
        success: boolean;
        data?: {
            collection: Collection;
            price_history: Array<{ date: string; floor: number; avg: number }>;
            volume_history: Array<{ date: string; volume: number; sales: number }>;
            holder_distribution: Array<{ range: string; count: number }>;
            trait_rarity: Record<string, Record<string, { count: number; percentage: number }>>;
        };
        error?: string;
    }> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return { success: false, error: 'Collection not found' };
        }

        const nfts = this.collectionNFTs.get(collectionId) || [];

        // Calculate trait rarity
        const traitRarity: Record<string, Record<string, { count: number; percentage: number }>> = {};
        for (const nft of nfts) {
            for (const attr of nft.attributes) {
                if (!traitRarity[attr.trait_type]) {
                    traitRarity[attr.trait_type] = {};
                }
                const value = String(attr.value);
                if (!traitRarity[attr.trait_type][value]) {
                    traitRarity[attr.trait_type][value] = { count: 0, percentage: 0 };
                }
                traitRarity[attr.trait_type][value].count++;
            }
        }

        // Calculate percentages
        for (const trait of Object.values(traitRarity)) {
            for (const value of Object.values(trait)) {
                value.percentage = (value.count / nfts.length) * 100;
            }
        }

        // Holder distribution
        const holderCounts: Record<string, number> = {};
        for (const nft of nfts) {
            holderCounts[nft.owner] = (holderCounts[nft.owner] || 0) + 1;
        }

        const holderDistribution = [
            { range: '1', count: Object.values(holderCounts).filter(c => c === 1).length },
            { range: '2-5', count: Object.values(holderCounts).filter(c => c >= 2 && c <= 5).length },
            { range: '6-10', count: Object.values(holderCounts).filter(c => c >= 6 && c <= 10).length },
            { range: '11-25', count: Object.values(holderCounts).filter(c => c >= 11 && c <= 25).length },
            { range: '26+', count: Object.values(holderCounts).filter(c => c > 25).length }
        ];

        return {
            success: true,
            data: {
                collection,
                price_history: [], // Would come from historical data
                volume_history: [], // Would come from historical data
                holder_distribution: holderDistribution,
                trait_rarity: traitRarity
            }
        };
    }

    /**
     * Get service health
     */
    getHealth(): {
        healthy: boolean;
        collections_count: number;
        total_nfts: number;
        cache_size: number;
    } {
        let totalNFTs = 0;
        for (const nfts of this.collectionNFTs.values()) {
            totalNFTs += nfts.length;
        }

        return {
            healthy: this.initialized,
            collections_count: this.collections.size,
            total_nfts: totalNFTs,
            cache_size: this.cache.size
        };
    }

    isReady(): boolean {
        return this.initialized;
    }
}

export const collectionService = new CollectionService();
