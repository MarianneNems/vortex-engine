/**
 * Creator/Artist Profile Service - Production Grade
 * Artist profiles, portfolios, and social features like Foundation & SuperRare
 * 
 * Features:
 * - Artist profiles with verification
 * - Portfolio management
 * - Follower/following system
 * - Sales analytics per creator
 * - Curation and featured artists
 * - Social links and bio
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

import { logger } from '../utils/logger';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'featured';

export interface SocialLinks {
    twitter?: string;
    instagram?: string;
    website?: string;
    discord?: string;
    youtube?: string;
    tiktok?: string;
    linkedin?: string;
}

export interface CreatorStats {
    total_sales: number;
    total_volume: number;
    volume_30d: number;
    items_created: number;
    items_sold: number;
    collections_count: number;
    floor_price: number;
    highest_sale: number;
    avg_sale_price: number;
    followers_count: number;
    following_count: number;
}

export interface CreatorProfile {
    id: string;
    
    // Wallet/Identity
    wallet_address: string;
    ens_name?: string;
    
    // Profile info
    username: string;
    display_name: string;
    bio?: string;
    avatar_url?: string;
    banner_url?: string;
    
    // Verification
    verification_status: VerificationStatus;
    verified_at?: Date;
    
    // Social
    social_links: SocialLinks;
    
    // Stats
    stats: CreatorStats;
    
    // Collections
    collection_ids: string[];
    
    // Preferences
    accepting_commissions: boolean;
    commission_info?: string;
    
    // Timestamps
    created_at: Date;
    updated_at: Date;
    last_active: Date;
    
    // Ranking
    rank?: number;
    trending_score: number;
}

export interface FollowRelation {
    follower_address: string;
    following_address: string;
    created_at: Date;
}

export interface CreatorActivity {
    id: string;
    creator_id: string;
    type: 'mint' | 'sale' | 'listing' | 'collection_created' | 'follow' | 'profile_update';
    description: string;
    metadata?: Record<string, any>;
    created_at: Date;
}

export class CreatorService {
    private profiles: Map<string, CreatorProfile> = new Map();
    private profilesByWallet: Map<string, string> = new Map(); // wallet -> profile_id
    private followers: Map<string, Set<string>> = new Map(); // profile_id -> follower_addresses
    private following: Map<string, Set<string>> = new Map(); // wallet -> following_profile_ids
    private activities: CreatorActivity[] = [];
    
    private initialized: boolean = true;

    constructor() {
        logger.info('[Creator Service] Initialized');
    }

    /**
     * Create or update creator profile
     */
    async createOrUpdateProfile(data: {
        wallet_address: string;
        username?: string;
        display_name?: string;
        bio?: string;
        avatar_url?: string;
        banner_url?: string;
        social_links?: SocialLinks;
        accepting_commissions?: boolean;
        commission_info?: string;
    }): Promise<{ success: boolean; profile?: CreatorProfile; error?: string }> {
        try {
            // Check if profile exists for this wallet
            const existingId = this.profilesByWallet.get(data.wallet_address);
            
            if (existingId) {
                // Update existing
                const profile = this.profiles.get(existingId)!;
                
                if (data.username && data.username !== profile.username) {
                    // Check username uniqueness
                    for (const p of this.profiles.values()) {
                        if (p.username.toLowerCase() === data.username.toLowerCase() && p.id !== existingId) {
                            return { success: false, error: 'Username already taken' };
                        }
                    }
                    profile.username = data.username;
                }
                
                if (data.display_name) profile.display_name = data.display_name;
                if (data.bio !== undefined) profile.bio = data.bio;
                if (data.avatar_url) profile.avatar_url = data.avatar_url;
                if (data.banner_url) profile.banner_url = data.banner_url;
                if (data.social_links) profile.social_links = { ...profile.social_links, ...data.social_links };
                if (data.accepting_commissions !== undefined) profile.accepting_commissions = data.accepting_commissions;
                if (data.commission_info !== undefined) profile.commission_info = data.commission_info;
                
                profile.updated_at = new Date();
                profile.last_active = new Date();
                
                this.recordActivity(profile.id, 'profile_update', 'Updated profile');
                
                return { success: true, profile };
            }
            
            // Create new profile
            const profileId = `CRE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const username = data.username || `user_${data.wallet_address.slice(0, 8)}`;
            
            // Check username uniqueness
            for (const p of this.profiles.values()) {
                if (p.username.toLowerCase() === username.toLowerCase()) {
                    return { success: false, error: 'Username already taken' };
                }
            }
            
            const profile: CreatorProfile = {
                id: profileId,
                wallet_address: data.wallet_address,
                username,
                display_name: data.display_name || username,
                bio: data.bio,
                avatar_url: data.avatar_url,
                banner_url: data.banner_url,
                verification_status: 'unverified',
                social_links: data.social_links || {},
                stats: {
                    total_sales: 0,
                    total_volume: 0,
                    volume_30d: 0,
                    items_created: 0,
                    items_sold: 0,
                    collections_count: 0,
                    floor_price: 0,
                    highest_sale: 0,
                    avg_sale_price: 0,
                    followers_count: 0,
                    following_count: 0
                },
                collection_ids: [],
                accepting_commissions: data.accepting_commissions || false,
                commission_info: data.commission_info,
                created_at: new Date(),
                updated_at: new Date(),
                last_active: new Date(),
                trending_score: 0
            };
            
            this.profiles.set(profileId, profile);
            this.profilesByWallet.set(data.wallet_address, profileId);
            this.followers.set(profileId, new Set());
            
            logger.info(`[Creator] Profile created: ${profileId} (${username})`);
            return { success: true, profile };
            
        } catch (error: any) {
            logger.error('[Creator] Create profile failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get profile by ID
     */
    async getProfile(profileId: string): Promise<CreatorProfile | null> {
        return this.profiles.get(profileId) || null;
    }

    /**
     * Get profile by wallet address
     */
    async getProfileByWallet(walletAddress: string): Promise<CreatorProfile | null> {
        const profileId = this.profilesByWallet.get(walletAddress);
        if (!profileId) return null;
        return this.profiles.get(profileId) || null;
    }

    /**
     * Get profile by username
     */
    async getProfileByUsername(username: string): Promise<CreatorProfile | null> {
        for (const profile of this.profiles.values()) {
            if (profile.username.toLowerCase() === username.toLowerCase()) {
                return profile;
            }
        }
        return null;
    }

    /**
     * Follow a creator
     */
    async follow(followerWallet: string, creatorProfileId: string): Promise<boolean> {
        const profile = this.profiles.get(creatorProfileId);
        if (!profile) return false;
        
        // Can't follow yourself
        if (profile.wallet_address === followerWallet) return false;
        
        // Get or create followers set
        let profileFollowers = this.followers.get(creatorProfileId);
        if (!profileFollowers) {
            profileFollowers = new Set();
            this.followers.set(creatorProfileId, profileFollowers);
        }
        
        // Get or create following set
        let userFollowing = this.following.get(followerWallet);
        if (!userFollowing) {
            userFollowing = new Set();
            this.following.set(followerWallet, userFollowing);
        }
        
        // Already following
        if (profileFollowers.has(followerWallet)) {
            return true;
        }
        
        profileFollowers.add(followerWallet);
        userFollowing.add(creatorProfileId);
        
        profile.stats.followers_count = profileFollowers.size;
        
        // Update follower's following count if they have a profile
        const followerProfileId = this.profilesByWallet.get(followerWallet);
        if (followerProfileId) {
            const followerProfile = this.profiles.get(followerProfileId);
            if (followerProfile) {
                followerProfile.stats.following_count = userFollowing.size;
            }
        }
        
        this.recordActivity(creatorProfileId, 'follow', `New follower: ${followerWallet.slice(0, 8)}...`);
        
        logger.info(`[Creator] ${followerWallet.slice(0, 8)} followed ${profile.username}`);
        return true;
    }

    /**
     * Unfollow a creator
     */
    async unfollow(followerWallet: string, creatorProfileId: string): Promise<boolean> {
        const profile = this.profiles.get(creatorProfileId);
        if (!profile) return false;
        
        const profileFollowers = this.followers.get(creatorProfileId);
        const userFollowing = this.following.get(followerWallet);
        
        if (profileFollowers) {
            profileFollowers.delete(followerWallet);
            profile.stats.followers_count = profileFollowers.size;
        }
        
        if (userFollowing) {
            userFollowing.delete(creatorProfileId);
            
            const followerProfileId = this.profilesByWallet.get(followerWallet);
            if (followerProfileId) {
                const followerProfile = this.profiles.get(followerProfileId);
                if (followerProfile) {
                    followerProfile.stats.following_count = userFollowing.size;
                }
            }
        }
        
        return true;
    }

    /**
     * Check if following
     */
    isFollowing(followerWallet: string, creatorProfileId: string): boolean {
        const profileFollowers = this.followers.get(creatorProfileId);
        return profileFollowers?.has(followerWallet) || false;
    }

    /**
     * Get followers
     */
    async getFollowers(profileId: string, limit: number = 50, offset: number = 0): Promise<{
        followers: CreatorProfile[];
        total: number;
    }> {
        const followerAddresses = this.followers.get(profileId);
        if (!followerAddresses) {
            return { followers: [], total: 0 };
        }
        
        const addresses = Array.from(followerAddresses).slice(offset, offset + limit);
        const followers: CreatorProfile[] = [];
        
        for (const addr of addresses) {
            const profileId = this.profilesByWallet.get(addr);
            if (profileId) {
                const profile = this.profiles.get(profileId);
                if (profile) followers.push(profile);
            }
        }
        
        return { followers, total: followerAddresses.size };
    }

    /**
     * Get following
     */
    async getFollowing(walletAddress: string, limit: number = 50, offset: number = 0): Promise<{
        following: CreatorProfile[];
        total: number;
    }> {
        const followingIds = this.following.get(walletAddress);
        if (!followingIds) {
            return { following: [], total: 0 };
        }
        
        const ids = Array.from(followingIds).slice(offset, offset + limit);
        const following: CreatorProfile[] = [];
        
        for (const id of ids) {
            const profile = this.profiles.get(id);
            if (profile) following.push(profile);
        }
        
        return { following, total: followingIds.size };
    }

    /**
     * List creators with filtering
     */
    async listCreators(options: {
        verification_status?: VerificationStatus;
        sort_by?: 'volume' | 'followers' | 'created' | 'trending' | 'sales';
        sort_order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
        search?: string;
    } = {}): Promise<{ creators: CreatorProfile[]; total: number; has_more: boolean }> {
        let creators = Array.from(this.profiles.values());
        
        // Filter by verification
        if (options.verification_status) {
            creators = creators.filter(c => c.verification_status === options.verification_status);
        }
        
        // Search
        if (options.search) {
            const search = options.search.toLowerCase();
            creators = creators.filter(c =>
                c.username.toLowerCase().includes(search) ||
                c.display_name.toLowerCase().includes(search) ||
                c.bio?.toLowerCase().includes(search) ||
                c.wallet_address.toLowerCase().includes(search)
            );
        }
        
        // Sort
        const order = options.sort_order === 'asc' ? 1 : -1;
        switch (options.sort_by) {
            case 'volume':
                creators.sort((a, b) => (b.stats.total_volume - a.stats.total_volume) * order);
                break;
            case 'followers':
                creators.sort((a, b) => (b.stats.followers_count - a.stats.followers_count) * order);
                break;
            case 'sales':
                creators.sort((a, b) => (b.stats.total_sales - a.stats.total_sales) * order);
                break;
            case 'trending':
                creators.sort((a, b) => (b.trending_score - a.trending_score) * order);
                break;
            case 'created':
            default:
                creators.sort((a, b) => (b.created_at.getTime() - a.created_at.getTime()) * order);
        }
        
        const total = creators.length;
        const limit = options.limit || 20;
        const offset = options.offset || 0;
        creators = creators.slice(offset, offset + limit);
        
        return { creators, total, has_more: offset + creators.length < total };
    }

    /**
     * Get featured/top creators
     */
    async getTopCreators(by: 'volume' | 'followers' | 'trending' = 'volume', limit: number = 10): Promise<CreatorProfile[]> {
        const result = await this.listCreators({
            sort_by: by === 'followers' ? 'followers' : by === 'trending' ? 'trending' : 'volume',
            sort_order: 'desc',
            limit
        });
        return result.creators;
    }

    /**
     * Get verified creators
     */
    async getVerifiedCreators(limit: number = 20): Promise<CreatorProfile[]> {
        const result = await this.listCreators({
            verification_status: 'verified',
            sort_by: 'volume',
            limit
        });
        return result.creators;
    }

    /**
     * Verify a creator
     */
    async verifyCreator(profileId: string, status: VerificationStatus = 'verified'): Promise<boolean> {
        const profile = this.profiles.get(profileId);
        if (!profile) return false;
        
        profile.verification_status = status;
        if (status === 'verified' || status === 'featured') {
            profile.verified_at = new Date();
            profile.trending_score += 100;
        }
        profile.updated_at = new Date();
        
        logger.info(`[Creator] Verified: ${profileId} as ${status}`);
        return true;
    }

    /**
     * Record a sale for a creator
     */
    async recordSale(walletAddress: string, amount: number, itemSold: boolean = true): Promise<void> {
        const profileId = this.profilesByWallet.get(walletAddress);
        if (!profileId) return;
        
        const profile = this.profiles.get(profileId);
        if (!profile) return;
        
        profile.stats.total_sales++;
        profile.stats.total_volume += amount;
        profile.stats.volume_30d += amount;
        
        if (itemSold) {
            profile.stats.items_sold++;
        }
        
        if (amount > profile.stats.highest_sale) {
            profile.stats.highest_sale = amount;
        }
        
        profile.stats.avg_sale_price = profile.stats.total_volume / profile.stats.total_sales;
        profile.trending_score += amount * 0.1;
        profile.last_active = new Date();
        profile.updated_at = new Date();
        
        this.recordActivity(profileId, 'sale', `Sold item for ${amount}`);
    }

    /**
     * Record item creation
     */
    async recordItemCreated(walletAddress: string): Promise<void> {
        const profileId = this.profilesByWallet.get(walletAddress);
        if (!profileId) return;
        
        const profile = this.profiles.get(profileId);
        if (!profile) return;
        
        profile.stats.items_created++;
        profile.last_active = new Date();
        profile.updated_at = new Date();
        
        this.recordActivity(profileId, 'mint', 'Created new item');
    }

    /**
     * Add collection to creator
     */
    async addCollection(walletAddress: string, collectionId: string): Promise<void> {
        const profileId = this.profilesByWallet.get(walletAddress);
        if (!profileId) return;
        
        const profile = this.profiles.get(profileId);
        if (!profile) return;
        
        if (!profile.collection_ids.includes(collectionId)) {
            profile.collection_ids.push(collectionId);
            profile.stats.collections_count++;
        }
        
        profile.last_active = new Date();
        profile.updated_at = new Date();
        
        this.recordActivity(profileId, 'collection_created', 'Created new collection');
    }

    /**
     * Get creator activity
     */
    async getCreatorActivity(profileId: string, limit: number = 50): Promise<CreatorActivity[]> {
        return this.activities
            .filter(a => a.creator_id === profileId)
            .slice(0, limit);
    }

    /**
     * Record activity
     */
    private recordActivity(creatorId: string, type: CreatorActivity['type'], description: string, metadata?: Record<string, any>): void {
        const activity: CreatorActivity = {
            id: `CACT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            creator_id: creatorId,
            type,
            description,
            metadata,
            created_at: new Date()
        };
        this.activities.unshift(activity);
        
        if (this.activities.length > 10000) {
            this.activities = this.activities.slice(0, 10000);
        }
    }

    getHealth(): { healthy: boolean; total_creators: number; verified_creators: number } {
        let verified = 0;
        for (const profile of this.profiles.values()) {
            if (profile.verification_status === 'verified' || profile.verification_status === 'featured') {
                verified++;
            }
        }
        
        return {
            healthy: this.initialized,
            total_creators: this.profiles.size,
            verified_creators: verified
        };
    }

    isReady(): boolean {
        return this.initialized;
    }
}

export const creatorService = new CreatorService();
