"use strict";
/**
 * NFT Minting Service - Metaplex Integration
 *
 * @version 4.0.0
 * @description Handles NFT minting for WooCommerce products on Solana
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NFTMintService = void 0;
const web3_js_1 = require("@solana/web3.js");
const js_1 = require("@metaplex-foundation/js");
const bs58 = __importStar(require("bs58"));
const axios_1 = __importDefault(require("axios"));
const database_service_1 = require("./database.service");
const logger_1 = require("../utils/logger");
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || (0, web3_js_1.clusterApiUrl)('mainnet-beta');
const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_PUBKEY || process.env.TREASURY_WALLET_PUBLIC || '';
// IMMUTABLE ROYALTY CONFIGURATION - DO NOT MODIFY
const IMMUTABLE_ROYALTY_BPS = 500; // 5% - LOCKED
const PLATFORM_ROYALTY_WALLET = process.env.PLATFORM_COMMISSION_WALLET || 'EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz';
class NFTMintService {
    constructor() {
        this.initialized = false;
        this.connection = new web3_js_1.Connection(RPC_URL, 'confirmed');
        this.db = new database_service_1.DatabaseService();
        // Load platform keypair from environment (secure)
        const privateKeyBase58 = process.env.TREASURY_WALLET_PRIVATE;
        if (!privateKeyBase58) {
            logger_1.logger.warn('[NFT] TREASURY_WALLET_PRIVATE not set - NFT minting will fail until configured');
            // Create dummy keypair for initialization (will fail on actual mint)
            const dummyKeypair = web3_js_1.Keypair.generate();
            this.metaplex = js_1.Metaplex.make(this.connection)
                .use((0, js_1.keypairIdentity)(dummyKeypair));
            this.initialized = false;
            logger_1.logger.info('[NFT] Metaplex initialized in DEMO mode (no real minting)');
        }
        else {
            try {
                const privateKeyBytes = bs58.decode(privateKeyBase58);
                const platformKeypair = web3_js_1.Keypair.fromSecretKey(privateKeyBytes);
                this.metaplex = js_1.Metaplex.make(this.connection)
                    .use((0, js_1.keypairIdentity)(platformKeypair));
                this.initialized = true;
                logger_1.logger.info('[NFT] Metaplex initialized with treasury keypair - Real minting ready');
                logger_1.logger.info(`[NFT] Treasury wallet: ${platformKeypair.publicKey.toString()}`);
            }
            catch (error) {
                logger_1.logger.error('[NFT] Failed to load treasury keypair:', error);
                throw new Error('Invalid TREASURY_WALLET_PRIVATE - check Base58 encoding');
            }
        }
    }
    /**
     * Check if service is properly initialized for real minting
     */
    isReady() {
        return this.initialized;
    }
    /**
     * Get service status
     */
    getStatus() {
        return {
            ready: this.initialized,
            treasury: PLATFORM_TREASURY || 'NOT_CONFIGURED',
            rpc: RPC_URL
        };
    }
    /**
     * Mint NFT for WooCommerce product
     */
    async mintProductNFT(data) {
        // Check if service is ready for real minting
        if (!this.initialized) {
            logger_1.logger.error('[NFT] Service not initialized - TREASURY_WALLET_PRIVATE not configured');
            throw new Error('NFT minting service not configured. Set TREASURY_WALLET_PRIVATE environment variable.');
        }
        try {
            logger_1.logger.info(`[NFT] Minting NFT for product ${data.productId}: ${data.name}`);
            // Download product image
            const imageBuffer = await this.downloadImage(data.imageUrl);
            // Upload image to Arweave via Bundlr
            const imageFile = (0, js_1.toMetaplexFile)(imageBuffer, `product-${data.productId}.jpg`);
            const imageUri = await this.metaplex.storage().upload(imageFile);
            logger_1.logger.info(`[NFT] Image uploaded: ${imageUri}`);
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
            logger_1.logger.info(`[NFT] Metadata uploaded: ${metadataUri}`);
            // Mint NFT with IMMUTABLE 5% royalty
            const { nft } = await this.metaplex.nfts().create({
                uri: metadataUri,
                name: data.name.substring(0, 32), // Solana name limit
                sellerFeeBasisPoints: IMMUTABLE_ROYALTY_BPS, // 5% IMMUTABLE royalty
                symbol: 'VORTEX',
                creators: [
                    {
                        address: new web3_js_1.PublicKey(PLATFORM_ROYALTY_WALLET),
                        share: 100,
                        authority: this.metaplex.identity()
                    }
                ]
            });
            logger_1.logger.info(`[NFT] Royalty: ${IMMUTABLE_ROYALTY_BPS} BPS (5%) to ${PLATFORM_ROYALTY_WALLET}`);
            const mintAddress = nft.address.toString();
            const signature = nft.mint.address.toString(); // Transaction signature
            logger_1.logger.info(`[NFT] Minted successfully: ${mintAddress}`);
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
        }
        catch (error) {
            logger_1.logger.error('[NFT] Mint error:', error);
            throw error;
        }
    }
    /**
     * Check if product already has NFT mint
     */
    async getProductMint(productId) {
        try {
            const asset = await this.db.getProductAsset(productId);
            return asset ? asset.nftMint : null;
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Download product image
     */
    async downloadImage(url) {
        try {
            const response = await axios_1.default.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data);
        }
        catch (error) {
            logger_1.logger.error('[NFT] Image download error:', error);
            throw new Error('Failed to download product image');
        }
    }
}
exports.NFTMintService = NFTMintService;
//# sourceMappingURL=nft-mint.service.js.map