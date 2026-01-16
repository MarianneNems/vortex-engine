/**
 * Marketplace Routes - Production Grade
 * Full NFT marketplace API comparable to OpenSea, Foundation, SuperRare
 * 
 * Endpoints:
 * - Collections: CRUD, trending, search
 * - Listings: Fixed price, auctions
 * - Offers: Item and collection offers
 * - Activity: Feed, price history
 * - Creators: Profiles, following
 * - Discovery: Trending, featured, search
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { collectionService, CollectionCategory } from '../services/collection.service';
import { marketplaceService, ListingType, Currency } from '../services/marketplace.service';
import { creatorService, VerificationStatus } from '../services/creator.service';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

// ============================================
// COLLECTIONS
// ============================================

/**
 * POST /api/marketplace/collections
 * Create a new collection
 */
router.post('/collections', authMiddleware, async (req: Request, res: Response) => {
    try {
        const result = await collectionService.createCollection(req.body);
        
        if (result.success) {
            // Add collection to creator profile
            if (req.body.creator_wallet) {
                await creatorService.addCollection(req.body.creator_wallet, result.collection!.id);
            }
            
            return res.status(201).json({
                success: true,
                data: result.collection,
                mint_address: result.mint_address,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        logger.error('[Marketplace] Create collection error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/collections
 * List collections with filtering
 */
router.get('/collections', async (req: Request, res: Response) => {
    try {
        const result = await collectionService.listCollections({
            category: req.query.category as CollectionCategory,
            verified_only: req.query.verified === 'true',
            sort_by: req.query.sort_by as any,
            sort_order: req.query.sort_order as any,
            limit: parseInt(req.query.limit as string) || 20,
            offset: parseInt(req.query.offset as string) || 0,
            search: req.query.search as string
        });
        
        return res.json({
            success: true,
            data: result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/collections/trending
 * Get trending collections
 */
router.get('/collections/trending', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
        const collections = await collectionService.getTrendingCollections(limit);
        
        return res.json({
            success: true,
            data: { collections, count: collections.length },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/collections/top
 * Get top collections by volume
 */
router.get('/collections/top', async (req: Request, res: Response) => {
    try {
        const period = (req.query.period as '24h' | '7d' | '30d' | 'all') || '24h';
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
        const collections = await collectionService.getTopCollections(period, limit);
        
        return res.json({
            success: true,
            data: { collections, period, count: collections.length },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/collections/:id
 * Get collection details
 */
router.get('/collections/:id', async (req: Request, res: Response) => {
    try {
        const collection = await collectionService.getCollection(req.params.id);
        
        if (!collection) {
            return res.status(404).json({ success: false, error: 'Collection not found' });
        }
        
        return res.json({
            success: true,
            data: collection,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/collections/:id/nfts
 * Get NFTs in collection
 */
router.get('/collections/:id/nfts', async (req: Request, res: Response) => {
    try {
        const result = await collectionService.getCollectionNFTs(req.params.id, {
            sort_by: req.query.sort_by as any,
            listed_only: req.query.listed === 'true',
            limit: parseInt(req.query.limit as string) || 20,
            offset: parseInt(req.query.offset as string) || 0
        });
        
        return res.json({
            success: true,
            data: result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/collections/:id/analytics
 * Get collection analytics
 */
router.get('/collections/:id/analytics', async (req: Request, res: Response) => {
    try {
        const result = await collectionService.getCollectionAnalytics(req.params.id);
        
        if (!result.success) {
            return res.status(404).json(result);
        }
        
        return res.json({
            success: true,
            data: result.data,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// LISTINGS
// ============================================

/**
 * POST /api/marketplace/listings
 * Create a new listing
 */
router.post('/listings', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { 
            mint_address, seller_address, type, price, currency,
            starting_price, reserve_price, buy_now_price,
            ending_price, price_drop_interval, duration_hours,
            royalty_bps, collection_id, name, image
        } = req.body;
        
        if (!mint_address || !seller_address || !type) {
            return res.status(400).json({
                success: false,
                error: 'mint_address, seller_address, and type are required'
            });
        }
        
        const result = await marketplaceService.createListing({
            mint_address,
            seller_address,
            type: type as ListingType,
            price: price || starting_price,
            currency: currency as Currency,
            starting_price,
            reserve_price,
            buy_now_price,
            ending_price,
            price_drop_interval,
            duration_hours,
            royalty_bps,
            collection_id,
            name,
            image
        });
        
        if (result.success) {
            return res.status(201).json({
                success: true,
                data: result.listing,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        logger.error('[Marketplace] Create listing error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/listings
 * Get listings with filtering
 */
router.get('/listings', async (req: Request, res: Response) => {
    try {
        const result = await marketplaceService.getListings({
            status: req.query.status as any,
            type: req.query.type as any,
            collection_id: req.query.collection_id as string,
            seller_address: req.query.seller as string,
            currency: req.query.currency as Currency,
            min_price: req.query.min_price ? parseFloat(req.query.min_price as string) : undefined,
            max_price: req.query.max_price ? parseFloat(req.query.max_price as string) : undefined,
            sort_by: req.query.sort_by as any,
            sort_order: req.query.sort_order as any,
            limit: parseInt(req.query.limit as string) || 20,
            offset: parseInt(req.query.offset as string) || 0
        });
        
        return res.json({
            success: true,
            data: result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/marketplace/listings/:id/bid
 * Place a bid on an auction
 */
router.post('/listings/:id/bid', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { bidder_address, amount, bidder_name } = req.body;
        
        if (!bidder_address || !amount) {
            return res.status(400).json({
                success: false,
                error: 'bidder_address and amount are required'
            });
        }
        
        const result = await marketplaceService.placeBid({
            listing_id: req.params.id,
            bidder_address,
            amount,
            bidder_name
        });
        
        if (result.success) {
            return res.json({
                success: true,
                data: result.bid,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/marketplace/listings/:id/buy
 * Buy now
 */
router.post('/listings/:id/buy', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { buyer_address, buyer_name } = req.body;
        
        if (!buyer_address) {
            return res.status(400).json({
                success: false,
                error: 'buyer_address is required'
            });
        }
        
        const result = await marketplaceService.buyNow({
            listing_id: req.params.id,
            buyer_address,
            buyer_name
        });
        
        if (result.success) {
            // Record sale for creator
            await creatorService.recordSale(result.sale!.seller_address, result.sale!.sale_price);
            
            // Record sale for collection
            if (result.sale!.collection_id) {
                await collectionService.recordSale(
                    result.sale!.collection_id,
                    result.sale!.sale_price,
                    result.sale!.currency
                );
            }
            
            return res.json({
                success: true,
                data: result.sale,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/marketplace/listings/:id
 * Cancel a listing
 */
router.delete('/listings/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { seller_address } = req.body;
        
        const result = await marketplaceService.cancelListing(req.params.id, seller_address);
        
        if (result.success) {
            return res.json({ success: true, message: 'Listing cancelled' });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/marketplace/listings/:id/favorite
 * Toggle favorite
 */
router.post('/listings/:id/favorite', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { user_address } = req.body;
        const isFavorited = marketplaceService.toggleFavorite(req.params.id, user_address);
        
        return res.json({
            success: true,
            data: { is_favorited: isFavorited },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// OFFERS
// ============================================

/**
 * POST /api/marketplace/offers
 * Make an offer
 */
router.post('/offers', authMiddleware, async (req: Request, res: Response) => {
    try {
        const result = await marketplaceService.makeOffer(req.body);
        
        if (result.success) {
            return res.status(201).json({
                success: true,
                data: result.offer,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/marketplace/offers/:id/accept
 * Accept an offer
 */
router.post('/offers/:id/accept', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { seller_address } = req.body;
        const result = await marketplaceService.acceptOffer(req.params.id, seller_address);
        
        if (result.success) {
            return res.json({
                success: true,
                data: result.sale,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ACTIVITY & ANALYTICS
// ============================================

/**
 * GET /api/marketplace/activity
 * Get activity feed
 */
router.get('/activity', async (req: Request, res: Response) => {
    try {
        const activity = await marketplaceService.getActivity({
            mint_address: req.query.mint as string,
            collection_id: req.query.collection_id as string,
            address: req.query.address as string,
            type: req.query.type as any,
            limit: parseInt(req.query.limit as string) || 50,
            offset: parseInt(req.query.offset as string) || 0
        });
        
        return res.json({
            success: true,
            data: { activity, count: activity.length },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/price-history/:mint
 * Get price history for an NFT
 */
router.get('/price-history/:mint', async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const history = await marketplaceService.getPriceHistory(req.params.mint, days);
        
        return res.json({
            success: true,
            data: { history, count: history.length },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/stats
 * Get marketplace statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const marketStats = marketplaceService.getMarketplaceStats();
        const collectionHealth = collectionService.getHealth();
        const creatorHealth = creatorService.getHealth();
        
        return res.json({
            success: true,
            data: {
                marketplace: marketStats,
                collections: {
                    total: collectionHealth.collections_count,
                    total_nfts: collectionHealth.total_nfts
                },
                creators: {
                    total: creatorHealth.total_creators,
                    verified: creatorHealth.verified_creators
                }
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// CREATORS
// ============================================

/**
 * POST /api/marketplace/creators/profile
 * Create or update creator profile
 */
router.post('/creators/profile', authMiddleware, async (req: Request, res: Response) => {
    try {
        const result = await creatorService.createOrUpdateProfile(req.body);
        
        if (result.success) {
            return res.json({
                success: true,
                data: result.profile,
                version: '4.0.0',
                timestamp: new Date().toISOString()
            });
        }
        
        return res.status(400).json({ success: false, error: result.error });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/creators
 * List creators
 */
router.get('/creators', async (req: Request, res: Response) => {
    try {
        const result = await creatorService.listCreators({
            verification_status: req.query.verified as VerificationStatus,
            sort_by: req.query.sort_by as any,
            sort_order: req.query.sort_order as any,
            limit: parseInt(req.query.limit as string) || 20,
            offset: parseInt(req.query.offset as string) || 0,
            search: req.query.search as string
        });
        
        return res.json({
            success: true,
            data: result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/creators/top
 * Get top creators
 */
router.get('/creators/top', async (req: Request, res: Response) => {
    try {
        const by = (req.query.by as 'volume' | 'followers' | 'trending') || 'volume';
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
        const creators = await creatorService.getTopCreators(by, limit);
        
        return res.json({
            success: true,
            data: { creators, count: creators.length, ranked_by: by },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/creators/:id
 * Get creator profile
 */
router.get('/creators/:id', async (req: Request, res: Response) => {
    try {
        let profile = await creatorService.getProfile(req.params.id);
        
        // Try by username if not found by ID
        if (!profile) {
            profile = await creatorService.getProfileByUsername(req.params.id);
        }
        
        // Try by wallet
        if (!profile) {
            profile = await creatorService.getProfileByWallet(req.params.id);
        }
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Creator not found' });
        }
        
        return res.json({
            success: true,
            data: profile,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/marketplace/creators/:id/follow
 * Follow a creator
 */
router.post('/creators/:id/follow', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { follower_wallet } = req.body;
        const success = await creatorService.follow(follower_wallet, req.params.id);
        
        return res.json({
            success,
            message: success ? 'Followed' : 'Already following or cannot follow',
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/marketplace/creators/:id/follow
 * Unfollow a creator
 */
router.delete('/creators/:id/follow', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { follower_wallet } = req.body;
        await creatorService.unfollow(follower_wallet, req.params.id);
        
        return res.json({
            success: true,
            message: 'Unfollowed',
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/creators/:id/followers
 * Get creator's followers
 */
router.get('/creators/:id/followers', async (req: Request, res: Response) => {
    try {
        const result = await creatorService.getFollowers(
            req.params.id,
            parseInt(req.query.limit as string) || 50,
            parseInt(req.query.offset as string) || 0
        );
        
        return res.json({
            success: true,
            data: result,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/creators/:id/activity
 * Get creator activity
 */
router.get('/creators/:id/activity', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const activity = await creatorService.getCreatorActivity(req.params.id, limit);
        
        return res.json({
            success: true,
            data: { activity, count: activity.length },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// DISCOVERY / EXPLORE
// ============================================

/**
 * GET /api/marketplace/explore
 * Explore page - featured content
 */
router.get('/explore', async (req: Request, res: Response) => {
    try {
        const [trendingCollections, topCreators, recentListings] = await Promise.all([
            collectionService.getTrendingCollections(6),
            creatorService.getTopCreators('trending', 6),
            marketplaceService.getListings({ status: 'active', limit: 12 })
        ]);
        
        return res.json({
            success: true,
            data: {
                trending_collections: trendingCollections,
                top_creators: topCreators,
                recent_listings: recentListings.listings,
                stats: marketplaceService.getMarketplaceStats()
            },
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/marketplace/search
 * Global search
 */
router.get('/search', async (req: Request, res: Response) => {
    try {
        const query = req.query.q as string;
        const type = req.query.type as 'all' | 'collections' | 'creators' | 'nfts';
        const limit = parseInt(req.query.limit as string) || 10;
        
        if (!query || query.length < 2) {
            return res.status(400).json({ success: false, error: 'Query must be at least 2 characters' });
        }
        
        const results: any = {};
        
        if (!type || type === 'all' || type === 'collections') {
            const collections = await collectionService.listCollections({ search: query, limit });
            results.collections = collections.collections;
        }
        
        if (!type || type === 'all' || type === 'creators') {
            const creators = await creatorService.listCreators({ search: query, limit });
            results.creators = creators.creators;
        }
        
        return res.json({
            success: true,
            data: results,
            query,
            version: '4.0.0',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
export { router as marketplaceRoutes };
