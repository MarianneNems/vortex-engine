/**
 * Daily Asset Service - Production Grade
 * Manages daily platform assets, product bundles, and analytics
 * 
 * Features:
 * - Daily asset aggregation
 * - Product tracking with NFT status
 * - Category management
 * - Revenue analytics
 * - Caching for performance
 * - WordPress integration
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import axios from 'axios';
import { logger } from '../utils/logger';

// Configuration
const CONFIG = {
    cacheTTL: 300000, // 5 minutes
    wpAjaxUrl: process.env.WP_AJAX_URL || '',
    wpApiUrl: process.env.WP_API_URL || '',
    wooKey: process.env.WOO_CONSUMER_KEY || '',
    wooSecret: process.env.WOO_CONSUMER_SECRET || ''
};

export interface DailyAsset {
    id: string;
    date: string;
    total_products: number;
    total_value_usdc: number;
    featured_products: ProductInfo[];
    categories: CategorySummary[];
    created_at: string;
    updated_at: string;
}

export interface ProductInfo {
    id: number;
    name: string;
    slug?: string;
    price_usdc: number;
    regular_price?: number;
    sale_price?: number;
    artist_id: number;
    artist_name: string;
    category: string;
    categories?: string[];
    nft_status: 'pending' | 'minted' | 'none';
    nft_address?: string;
    nft_tx?: string;
    image_url?: string;
    thumbnail_url?: string;
    gallery_images?: string[];
    stock_status?: 'instock' | 'outofstock' | 'onbackorder';
    total_sales?: number;
    rating?: number;
    reviews_count?: number;
    created_at: string;
    updated_at?: string;
    metadata?: Record<string, any>;
}

export interface CategorySummary {
    id?: number;
    name: string;
    slug?: string;
    count: number;
    total_value: number;
    avg_price?: number;
}

export interface DailyBundle {
    date: string;
    total_assets: number;
    new_today: number;
    total_value_usdc: number;
    avg_price: number;
    featured: ProductInfo[];
    by_category: CategorySummary[];
    top_artists: ArtistSummary[];
    nft_stats: NFTStats;
    revenue_today: number;
}

export interface ArtistSummary {
    id: number;
    name: string;
    products_count: number;
    total_value: number;
    total_sales: number;
}

export interface NFTStats {
    total_minted: number;
    minted_today: number;
    pending: number;
    total_value: number;
}

export interface DailyAnalytics {
    date: string;
    views: number;
    unique_visitors: number;
    sales: number;
    revenue_usdc: number;
    new_products: number;
    new_users: number;
    top_products: ProductInfo[];
    conversion_rate: number;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export class DailyAssetService {
    private cache: Map<string, CacheEntry<any>> = new Map();
    private productsCache: ProductInfo[] = [];
    private lastProductsFetch: number = 0;
    private initialized: boolean = false;

    constructor() {
        this.initialized = true;
        logger.info('[Daily Asset Service] Initialized');
        
        // Start cache cleanup
        setInterval(() => this.cleanupCache(), CONFIG.cacheTTL);
    }

    /**
     * Clean expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > CONFIG.cacheTTL) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get cached data or fetch new
     */
    private getCached<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (entry && Date.now() - entry.timestamp < CONFIG.cacheTTL) {
            return entry.data as T;
        }
        return null;
    }

    /**
     * Set cache data
     */
    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Create daily bundle for today
     */
    async createDailyBundle(): Promise<DailyBundle> {
        const today = new Date().toISOString().split('T')[0];
        const cacheKey = `bundle_${today}`;
        
        // Check cache
        const cached = this.getCached<DailyBundle>(cacheKey);
        if (cached) {
            return cached;
        }
        
        try {
            logger.info(`[Daily Asset Service] Creating bundle for ${today}`);
            
            // Get all products
            const products = await this.getAllProducts();
            
            // Filter products created today
            const newToday = products.filter(p => {
                const productDate = p.created_at.split('T')[0];
                return productDate === today;
            });
            
            // Calculate totals
            const totalValue = products.reduce((sum, p) => sum + (p.price_usdc || 0), 0);
            const avgPrice = products.length > 0 ? totalValue / products.length : 0;
            
            // Aggregate by category
            const categoryMap = new Map<string, CategorySummary>();
            for (const product of products) {
                const cat = product.category || 'Uncategorized';
                const existing = categoryMap.get(cat) || { 
                    name: cat, 
                    count: 0, 
                    total_value: 0,
                    avg_price: 0
                };
                existing.count++;
                existing.total_value += product.price_usdc || 0;
                existing.avg_price = existing.total_value / existing.count;
                categoryMap.set(cat, existing);
            }
            
            // Aggregate by artist
            const artistMap = new Map<number, ArtistSummary>();
            for (const product of products) {
                const existing = artistMap.get(product.artist_id) || {
                    id: product.artist_id,
                    name: product.artist_name,
                    products_count: 0,
                    total_value: 0,
                    total_sales: 0
                };
                existing.products_count++;
                existing.total_value += product.price_usdc || 0;
                existing.total_sales += product.total_sales || 0;
                artistMap.set(product.artist_id, existing);
            }
            
            // Get top artists by value
            const topArtists = Array.from(artistMap.values())
                .sort((a, b) => b.total_value - a.total_value)
                .slice(0, 10);
            
            // NFT statistics
            const mintedNFTs = products.filter(p => p.nft_status === 'minted');
            const pendingNFTs = products.filter(p => p.nft_status === 'pending');
            const mintedToday = mintedNFTs.filter(p => {
                const date = p.updated_at?.split('T')[0];
                return date === today;
            });
            
            // Calculate revenue today (simplified - would need actual sales data)
            const revenueToday = newToday.reduce((sum, p) => sum + (p.price_usdc || 0) * (p.total_sales || 0), 0);
            
            // Select featured products (top by price, with images)
            const featured = [...products]
                .filter(p => p.image_url)
                .sort((a, b) => (b.price_usdc || 0) - (a.price_usdc || 0))
                .slice(0, 6);
            
            const bundle: DailyBundle = {
                date: today,
                total_assets: products.length,
                new_today: newToday.length,
                total_value_usdc: Math.round(totalValue * 100) / 100,
                avg_price: Math.round(avgPrice * 100) / 100,
                featured,
                by_category: Array.from(categoryMap.values())
                    .sort((a, b) => b.count - a.count),
                top_artists: topArtists,
                nft_stats: {
                    total_minted: mintedNFTs.length,
                    minted_today: mintedToday.length,
                    pending: pendingNFTs.length,
                    total_value: mintedNFTs.reduce((sum, p) => sum + (p.price_usdc || 0), 0)
                },
                revenue_today: revenueToday
            };
            
            // Cache the result
            this.setCache(cacheKey, bundle);
            
            logger.info(`[Daily Asset Service] Bundle created: ${bundle.total_assets} assets, $${bundle.total_value_usdc} total value`);
            
            return bundle;
            
        } catch (error: any) {
            logger.error('[Daily Asset Service] Create bundle failed:', error);
            
            // Return empty bundle on error
            return {
                date: today,
                total_assets: 0,
                new_today: 0,
                total_value_usdc: 0,
                avg_price: 0,
                featured: [],
                by_category: [],
                top_artists: [],
                nft_stats: {
                    total_minted: 0,
                    minted_today: 0,
                    pending: 0,
                    total_value: 0
                },
                revenue_today: 0
            };
        }
    }

    /**
     * Get today's bundle
     */
    async getTodayBundle(): Promise<DailyBundle | null> {
        try {
            return await this.createDailyBundle();
        } catch (error) {
            logger.error('[Daily Asset Service] Get today bundle failed:', error);
            return null;
        }
    }

    /**
     * Get all products with NFT status
     */
    async getProductsWithNFTs(): Promise<ProductInfo[]> {
        return this.getAllProducts();
    }

    /**
     * Get all products from WordPress/WooCommerce
     */
    async getAllProducts(): Promise<ProductInfo[]> {
        // Use cache if fresh enough
        if (this.productsCache.length > 0 && 
            Date.now() - this.lastProductsFetch < CONFIG.cacheTTL) {
            return this.productsCache;
        }
        
        try {
            // Try WooCommerce API first
            if (CONFIG.wpApiUrl && CONFIG.wooKey && CONFIG.wooSecret) {
                const products = await this.fetchFromWooCommerce();
                if (products.length > 0) {
                    this.productsCache = products;
                    this.lastProductsFetch = Date.now();
                    return products;
                }
            }
            
            // Fallback to WordPress AJAX
            if (CONFIG.wpAjaxUrl) {
                const products = await this.fetchFromWordPress();
                if (products.length > 0) {
                    this.productsCache = products;
                    this.lastProductsFetch = Date.now();
                    return products;
                }
            }
            
            // Return cached data if available
            if (this.productsCache.length > 0) {
                return this.productsCache;
            }
            
            // Return mock data as last resort
            return this.getMockProducts();
            
        } catch (error: any) {
            logger.error('[Daily Asset Service] Get products failed:', error);
            return this.productsCache.length > 0 ? this.productsCache : this.getMockProducts();
        }
    }

    /**
     * Fetch products from WooCommerce REST API
     */
    private async fetchFromWooCommerce(): Promise<ProductInfo[]> {
        try {
            const response = await axios.get(`${CONFIG.wpApiUrl}/wp-json/wc/v3/products`, {
                auth: {
                    username: CONFIG.wooKey,
                    password: CONFIG.wooSecret
                },
                params: {
                    per_page: 100,
                    status: 'publish'
                },
                timeout: 10000
            });
            
            return response.data.map((p: any) => this.mapWooProduct(p));
            
        } catch (error: any) {
            logger.warn('[Daily Asset Service] WooCommerce fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Fetch products from WordPress AJAX
     */
    private async fetchFromWordPress(): Promise<ProductInfo[]> {
        try {
            const response = await axios.get(CONFIG.wpAjaxUrl, {
                params: {
                    action: 'vortex_get_all_products'
                },
                timeout: 10000
            });
            
            if (response.data?.success && response.data?.data) {
                return response.data.data.map((p: any) => this.mapWordPressProduct(p));
            }
            
            return [];
            
        } catch (error: any) {
            logger.warn('[Daily Asset Service] WordPress fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Map WooCommerce product to ProductInfo
     */
    private mapWooProduct(p: any): ProductInfo {
        const nftMint = p.meta_data?.find((m: any) => m.key === 'vortex_nft_mint')?.value;
        const nftTx = p.meta_data?.find((m: any) => m.key === 'vortex_mint_tx')?.value;
        
        return {
            id: p.id,
            name: p.name,
            slug: p.slug,
            price_usdc: parseFloat(p.price) || 0,
            regular_price: parseFloat(p.regular_price) || 0,
            sale_price: parseFloat(p.sale_price) || undefined,
            artist_id: p.author || 0,
            artist_name: p.store?.shop_name || 'Unknown Artist',
            category: p.categories?.[0]?.name || 'Uncategorized',
            categories: p.categories?.map((c: any) => c.name) || [],
            nft_status: nftMint ? 'minted' : 'none',
            nft_address: nftMint,
            nft_tx: nftTx,
            image_url: p.images?.[0]?.src,
            thumbnail_url: p.images?.[0]?.src,
            gallery_images: p.images?.map((i: any) => i.src) || [],
            stock_status: p.stock_status,
            total_sales: p.total_sales || 0,
            rating: parseFloat(p.average_rating) || 0,
            reviews_count: p.rating_count || 0,
            created_at: p.date_created || new Date().toISOString(),
            updated_at: p.date_modified,
            metadata: {
                sku: p.sku,
                virtual: p.virtual,
                downloadable: p.downloadable
            }
        };
    }

    /**
     * Map WordPress product to ProductInfo
     */
    private mapWordPressProduct(p: any): ProductInfo {
        return {
            id: p.id || p.ID,
            name: p.name || p.post_title,
            price_usdc: parseFloat(p.price || p.price_usdc) || 0,
            artist_id: p.artist_id || p.post_author || 0,
            artist_name: p.artist_name || p.display_name || 'Unknown Artist',
            category: p.category || 'Uncategorized',
            nft_status: p.nft_status || 'none',
            nft_address: p.nft_address || p.nft_mint,
            image_url: p.image_url || p.thumbnail,
            created_at: p.created_at || p.post_date || new Date().toISOString()
        };
    }

    /**
     * Get product by ID
     */
    async getProduct(productId: number): Promise<ProductInfo | null> {
        try {
            const products = await this.getAllProducts();
            return products.find(p => p.id === productId) || null;
        } catch (error) {
            logger.error('[Daily Asset Service] Get product failed:', error);
            return null;
        }
    }

    /**
     * Get products by category
     */
    async getProductsByCategory(category: string): Promise<ProductInfo[]> {
        try {
            const products = await this.getAllProducts();
            return products.filter(p => 
                p.category?.toLowerCase() === category.toLowerCase() ||
                p.categories?.some(c => c.toLowerCase() === category.toLowerCase())
            );
        } catch (error) {
            logger.error('[Daily Asset Service] Get by category failed:', error);
            return [];
        }
    }

    /**
     * Get products by artist
     */
    async getProductsByArtist(artistId: number): Promise<ProductInfo[]> {
        try {
            const products = await this.getAllProducts();
            return products.filter(p => p.artist_id === artistId);
        } catch (error) {
            logger.error('[Daily Asset Service] Get by artist failed:', error);
            return [];
        }
    }

    /**
     * Get NFT-minted products
     */
    async getMintedProducts(): Promise<ProductInfo[]> {
        try {
            const products = await this.getAllProducts();
            return products.filter(p => p.nft_status === 'minted');
        } catch (error) {
            logger.error('[Daily Asset Service] Get minted products failed:', error);
            return [];
        }
    }

    /**
     * Get daily analytics
     */
    async getDailyAnalytics(date?: string): Promise<DailyAnalytics> {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const cacheKey = `analytics_${targetDate}`;
        
        // Check cache
        const cached = this.getCached<DailyAnalytics>(cacheKey);
        if (cached) {
            return cached;
        }
        
        try {
            const bundle = await this.createDailyBundle();
            
            const analytics: DailyAnalytics = {
                date: targetDate,
                views: 0, // Would need actual tracking data
                unique_visitors: 0,
                sales: bundle.featured.reduce((sum, p) => sum + (p.total_sales || 0), 0),
                revenue_usdc: bundle.revenue_today,
                new_products: bundle.new_today,
                new_users: 0,
                top_products: bundle.featured,
                conversion_rate: 0
            };
            
            this.setCache(cacheKey, analytics);
            return analytics;
            
        } catch (error: any) {
            logger.error('[Daily Asset Service] Get analytics failed:', error);
            return {
                date: targetDate,
                views: 0,
                unique_visitors: 0,
                sales: 0,
                revenue_usdc: 0,
                new_products: 0,
                new_users: 0,
                top_products: [],
                conversion_rate: 0
            };
        }
    }

    /**
     * Get mock products for testing
     */
    private getMockProducts(): ProductInfo[] {
        const now = new Date().toISOString();
        return [
            {
                id: 1,
                name: 'Digital Masterpiece #1',
                price_usdc: 150.00,
                artist_id: 1,
                artist_name: 'Vortex Artist',
                category: 'Digital Art',
                nft_status: 'minted',
                nft_address: 'MOCK_NFT_ADDRESS_1',
                image_url: '/placeholder-art-1.jpg',
                total_sales: 5,
                rating: 4.8,
                created_at: now
            },
            {
                id: 2,
                name: 'AI Generated Portrait',
                price_usdc: 75.00,
                artist_id: 2,
                artist_name: 'AI Creator',
                category: 'AI Art',
                nft_status: 'pending',
                image_url: '/placeholder-art-2.jpg',
                total_sales: 12,
                rating: 4.5,
                created_at: now
            },
            {
                id: 3,
                name: 'Abstract Collection',
                price_usdc: 200.00,
                artist_id: 1,
                artist_name: 'Vortex Artist',
                category: 'Abstract',
                nft_status: 'none',
                image_url: '/placeholder-art-3.jpg',
                total_sales: 3,
                rating: 4.9,
                created_at: now
            }
        ];
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
        this.productsCache = [];
        this.lastProductsFetch = 0;
        logger.info('[Daily Asset Service] Cache cleared');
    }

    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return this.initialized;
    }

    /**
     * Get service health
     */
    getHealth(): {
        healthy: boolean;
        cache_size: number;
        products_cached: number;
        wp_configured: boolean;
        woo_configured: boolean;
    } {
        return {
            healthy: this.initialized,
            cache_size: this.cache.size,
            products_cached: this.productsCache.length,
            wp_configured: !!CONFIG.wpAjaxUrl,
            woo_configured: !!(CONFIG.wpApiUrl && CONFIG.wooKey)
        };
    }
}
