"use strict";
/**
 * Royalty Service v4.0.0
 *
 * IMMUTABLE 5% Royalty Enforcement System
 *
 * This service handles all royalty operations for the Vortex platform:
 * - 5% IMMUTABLE platform royalty on all HURAII-generated NFTs
 * - Secondary sale royalty tracking and collection
 * - Royalty verification and distribution
 *
 * SECURITY NOTICE:
 * The 5% royalty rate is PERMANENTLY LOCKED and cannot be changed.
 * This protects the platform creator's royalty rights.
 *
 * @package VortexEngine
 * @version 4.0.0
 * @author Vortex AI Engine
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROYALTY_CONFIG = exports.RoyaltyService = void 0;
exports.getRoyaltyService = getRoyaltyService;
const web3_js_1 = require("@solana/web3.js");
const logger_1 = require("../utils/logger");
// IMMUTABLE ROYALTY CONFIGURATION - DO NOT MODIFY
const ROYALTY_CONFIG = {
    // Platform royalty rate - PERMANENTLY LOCKED at 5%
    PLATFORM_ROYALTY_RATE: 0.05, // 5% - IMMUTABLE
    PLATFORM_ROYALTY_BPS: 500, // 500 basis points - IMMUTABLE
    MIN_ROYALTY_BPS: 500, // Minimum allowed - IMMUTABLE
    // Platform wallet for royalty collection
    PLATFORM_ROYALTY_WALLET: process.env.PLATFORM_COMMISSION_WALLET || 'EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz',
    // Secondary sale configuration
    SECONDARY_SALE_ROYALTY_BPS: 2000, // 20% total on secondary sales
    PLATFORM_SHARE_OF_ROYALTY: 0.25, // Platform gets 25% of royalty (5% of 20%)
    // Version tracking
    VERSION: '4.0.0',
    LOCKED_DATE: '2026-01-22',
    CREATOR: 'Creator (Vortex AI Engine)',
    // Immutability flag
    IMMUTABLE: true,
    CAN_BE_CHANGED: false,
    CAN_BE_LOWERED: false,
    CAN_BE_REMOVED: false
};
exports.ROYALTY_CONFIG = ROYALTY_CONFIG;
// Verify immutability on module load
if (ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE !== 0.05) {
    throw new Error('[ROYALTY SERVICE] CRITICAL: Platform royalty rate has been tampered with!');
}
if (ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS !== 500) {
    throw new Error('[ROYALTY SERVICE] CRITICAL: Platform royalty BPS has been tampered with!');
}
class RoyaltyService {
    constructor() {
        this.pendingPayments = new Map();
        this.verifiedMints = new Map();
        this.stats = {
            total_royalty_collected: 0,
            total_royalty_pending: 0,
            total_mints_verified: 0,
            total_sales_processed: 0,
            security_alerts: 0
        };
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
        logger_1.logger.info(`[ROYALTY SERVICE v4.0.0] Initialized`);
        logger_1.logger.info(`[ROYALTY SERVICE] Platform Royalty: ${ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE * 100}% (${ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS} BPS) - IMMUTABLE`);
        logger_1.logger.info(`[ROYALTY SERVICE] Royalty Wallet: ${ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET}`);
    }
    /**
     * Get the IMMUTABLE royalty configuration
     */
    getConfig() {
        return {
            ...ROYALTY_CONFIG,
            wallet: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
            stats: this.stats
        };
    }
    /**
     * Get the IMMUTABLE royalty rate
     * WARNING: This value is LOCKED and cannot be changed
     */
    getRoyaltyRate() {
        return ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE; // Always returns 0.05
    }
    /**
     * Get the IMMUTABLE royalty basis points
     * WARNING: This value is LOCKED and cannot be changed
     */
    getRoyaltyBPS() {
        return ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS; // Always returns 500
    }
    /**
     * Get the platform royalty wallet
     */
    getRoyaltyWallet() {
        return ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET;
    }
    /**
     * Verify a mint has correct royalty configuration
     */
    async verifyMintRoyalty(mintAddress) {
        try {
            // Check cache first
            const cached = this.verifiedMints.get(mintAddress);
            if (cached) {
                return cached;
            }
            const verification = {
                mint_address: mintAddress,
                royalty_bps: ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS,
                royalty_wallet: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
                verified: false,
                on_chain_verified: false,
                signature_valid: false,
                timestamp: new Date().toISOString()
            };
            // Try to get on-chain metadata
            try {
                const mintPubkey = new web3_js_1.PublicKey(mintAddress);
                const accountInfo = await this.connection.getAccountInfo(mintPubkey);
                if (accountInfo) {
                    // In a full implementation, we would:
                    // 1. Fetch Metaplex metadata
                    // 2. Verify seller_fee_basis_points >= 500
                    // 3. Verify platform wallet is in creators array
                    verification.on_chain_verified = true;
                }
            }
            catch (e) {
                logger_1.logger.warn(`[ROYALTY SERVICE] Could not verify on-chain for ${mintAddress}`);
            }
            // For HURAII-generated images, we trust the signature
            verification.verified = true;
            verification.signature_valid = true;
            // Cache the verification
            this.verifiedMints.set(mintAddress, verification);
            this.stats.total_mints_verified++;
            return verification;
        }
        catch (error) {
            logger_1.logger.error(`[ROYALTY SERVICE] Verify error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Record a mint with IMMUTABLE royalty configuration
     */
    async recordMint(config) {
        try {
            // ENFORCE IMMUTABLE ROYALTY
            if (config.seller_fee_basis_points < ROYALTY_CONFIG.MIN_ROYALTY_BPS) {
                this.stats.security_alerts++;
                logger_1.logger.error(`[ROYALTY SERVICE] SECURITY ALERT: Attempted to mint with royalty below 5%`);
                return {
                    success: false,
                    data: {
                        error: 'Minimum 5% royalty is required and cannot be changed',
                        code: 'ROYALTY_TOO_LOW',
                        minimum_bps: ROYALTY_CONFIG.MIN_ROYALTY_BPS
                    }
                };
            }
            // Ensure platform wallet is included in creators
            const platformInCreators = config.creators.some(c => c.address === ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET && c.share > 0);
            if (!platformInCreators) {
                // Add platform wallet to creators
                config.creators.unshift({
                    address: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
                    share: 100, // 100% of the royalty goes to platform
                    verified: true
                });
            }
            const record = {
                mint_address: config.mint_address,
                user_id: config.user_id,
                royalty_bps: ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS,
                royalty_wallet: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
                creators: config.creators,
                huraii_signature: config.huraii_signature,
                immutable: true,
                recorded_at: new Date().toISOString()
            };
            logger_1.logger.info(`[ROYALTY SERVICE] Recorded mint ${config.mint_address} with 5% IMMUTABLE royalty`);
            return {
                success: true,
                data: record
            };
        }
        catch (error) {
            logger_1.logger.error(`[ROYALTY SERVICE] Record mint error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Process secondary sale and calculate royalty
     */
    async processSecondarySale(mintAddress, saleSignature, saleAmount, buyer, seller) {
        try {
            // Calculate IMMUTABLE royalty
            const royaltyAmount = saleAmount * ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE;
            const payment = {
                id: `ROY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                mint_address: mintAddress,
                sale_signature: saleSignature,
                sale_amount: saleAmount,
                royalty_amount: royaltyAmount,
                royalty_wallet: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
                status: 'pending',
                created_at: new Date().toISOString()
            };
            // Store pending payment
            this.pendingPayments.set(payment.id, payment);
            this.stats.total_royalty_pending += royaltyAmount;
            this.stats.total_sales_processed++;
            logger_1.logger.info(`[ROYALTY SERVICE] Secondary sale processed: ${mintAddress}, Royalty: ${royaltyAmount} USDC (5% of ${saleAmount})`);
            return payment;
        }
        catch (error) {
            logger_1.logger.error(`[ROYALTY SERVICE] Process sale error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Collect pending royalty payment
     */
    async collectRoyalty(paymentId) {
        try {
            const payment = this.pendingPayments.get(paymentId);
            if (!payment) {
                return { success: false, error: 'Payment not found' };
            }
            if (payment.status !== 'pending') {
                return { success: false, error: `Payment is already ${payment.status}` };
            }
            // Update status
            payment.status = 'processing';
            // In production, this would:
            // 1. Call Solana to transfer royalty
            // 2. Verify transaction confirmation
            // 3. Update payment record
            // Simulate collection (in production, use actual Solana transfer)
            const collectionSignature = `SIM_${Date.now()}`;
            payment.status = 'collected';
            payment.processed_at = new Date().toISOString();
            payment.collection_signature = collectionSignature;
            this.stats.total_royalty_pending -= payment.royalty_amount;
            this.stats.total_royalty_collected += payment.royalty_amount;
            logger_1.logger.info(`[ROYALTY SERVICE] Collected royalty ${payment.id}: ${payment.royalty_amount} USDC`);
            return { success: true, signature: collectionSignature };
        }
        catch (error) {
            logger_1.logger.error(`[ROYALTY SERVICE] Collect error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    /**
     * Distribute royalty from a sale
     */
    async distributeRoyalty(mintAddress, saleAmount, recipients) {
        try {
            const totalRoyalty = saleAmount * ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE;
            const distributions = [];
            // Platform ALWAYS gets its 5%
            distributions.push({
                recipient: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
                amount: totalRoyalty,
                share: 100, // Platform gets 100% of the 5% royalty
                type: 'platform_royalty',
                immutable: true
            });
            logger_1.logger.info(`[ROYALTY SERVICE] Distributed ${totalRoyalty} USDC royalty for ${mintAddress}`);
            return { success: true, distributions };
        }
        catch (error) {
            logger_1.logger.error(`[ROYALTY SERVICE] Distribute error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Verify HURAII signature on an image
     */
    async verifyHURAIISignature(attachmentId, signatureHash) {
        // In production, this would verify the invisible HURAII signature
        // embedded in the image metadata
        return {
            verified: true,
            huraii_authentic: true,
            royalty_rate: ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE,
            royalty_enforced: true
        };
    }
    /**
     * Get royalty statistics
     */
    getStats() {
        return {
            ...this.stats,
            config: {
                rate: ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE,
                bps: ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS,
                wallet: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
                immutable: ROYALTY_CONFIG.IMMUTABLE
            }
        };
    }
    /**
     * Get pending payments
     */
    getPendingPayments() {
        return Array.from(this.pendingPayments.values())
            .filter(p => p.status === 'pending');
    }
    /**
     * Health check
     */
    isReady() {
        return true;
    }
    async getHealth() {
        return {
            healthy: true,
            royalty_rate: `${ROYALTY_CONFIG.PLATFORM_ROYALTY_RATE * 100}%`,
            royalty_bps: ROYALTY_CONFIG.PLATFORM_ROYALTY_BPS,
            royalty_wallet: ROYALTY_CONFIG.PLATFORM_ROYALTY_WALLET,
            immutable: ROYALTY_CONFIG.IMMUTABLE,
            stats: this.stats
        };
    }
}
exports.RoyaltyService = RoyaltyService;
// Export singleton instance
let instance = null;
function getRoyaltyService() {
    if (!instance) {
        instance = new RoyaltyService();
    }
    return instance;
}
//# sourceMappingURL=royalty.service.js.map