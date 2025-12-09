/**
 * WooCommerce Webhook Routes
 */

import { Router, Request, Response } from 'express';
import { WooCommerceService } from '../services/woocommerce.service';
import { NFTMintService } from '../services/nft-mint.service';
import { PaymentService } from '../services/payment.service';
import { validateWooHMAC } from '../middleware/woo-hmac.middleware';
import { logger } from '../utils/logger';

const router = Router();
const wooService = new WooCommerceService();
const nftService = new NFTMintService();
const paymentService = new PaymentService();

/**
 * POST /wc/webhooks/product-published
 * When WooCommerce product is published, mint NFT on Solana
 */
router.post('/webhooks/product-published', validateWooHMAC, async (req: Request, res: Response) => {
    try {
        const product = req.body;
        
        logger.info(`[WOO] Product published webhook: ${product.id} - ${product.name}`);
        
        // Only process if status is "publish"
        if (product.status !== 'publish') {
            return res.json({
                success: true,
                message: 'Product not published, skipping NFT mint'
            });
        }
        
        // Check if already minted
        const existingMint = await nftService.getProductMint(product.id);
        if (existingMint) {
            logger.info(`[WOO] Product ${product.id} already has NFT mint: ${existingMint}`);
            return res.json({
                success: true,
                message: 'Product already has NFT mint',
                nftMint: existingMint
            });
        }
        
        // Mint NFT for this product
        const nftData = {
            productId: product.id,
            name: product.name,
            description: product.short_description || product.description,
            imageUrl: product.images[0]?.src || '',
            productUrl: product.permalink,
            price: parseFloat(product.price),
            sku: product.sku
        };
        
        const mintResult = await nftService.mintProductNFT(nftData);
        
        // Update WooCommerce product with NFT data
        await wooService.updateProductMeta(product.id, {
            vortex_nft_mint: mintResult.mintAddress,
            vortex_mint_tx: mintResult.signature,
            vortex_asset_id: mintResult.assetId,
            vortex_on_chain_uri: mintResult.metadataUri
        });
        
        logger.info(`[WOO] Product ${product.id} NFT minted: ${mintResult.mintAddress}`);
        
        res.json({
            success: true,
            message: 'NFT minted successfully',
            data: mintResult
        });
        
    } catch (error) {
        logger.error('[WOO] Product published webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process product publish',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /wc/webhooks/order-created
 * When WooCommerce order is created with TOLA Pay
 */
router.post('/webhooks/order-created', validateWooHMAC, async (req: Request, res: Response) => {
    try {
        const order = req.body;
        
        logger.info(`[WOO] Order created webhook: ${order.id}`);
        
        // Only process TOLA Pay orders
        if (order.payment_method !== 'tola_pay') {
            return res.json({
                success: true,
                message: 'Not a TOLA Pay order, skipping'
            });
        }
        
        // Calculate TOLA amount
        const usdAmount = parseFloat(order.total);
        const tolaAmount = usdAmount; // $1 = 1 TOLA
        
        // Create payment intent
        const intent = await paymentService.createPaymentIntent({
            orderId: order.id,
            amountUSD: usdAmount,
            amountTOLA: tolaAmount,
            buyerEmail: order.billing.email,
            items: order.line_items.map((item: any) => ({
                productId: item.product_id,
                name: item.name,
                quantity: item.quantity,
                total: parseFloat(item.total)
            }))
        });
        
        logger.info(`[WOO] Payment intent created: ${intent.id}`);
        
        res.json({
            success: true,
            message: 'Payment intent created',
            data: intent
        });
        
    } catch (error) {
        logger.error('[WOO] Order created webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create payment intent',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /wc/webhooks/order-paid
 * Called after on-chain TOLA payment is confirmed
 */
router.post('/webhooks/order-paid', validateWooHMAC, async (req: Request, res: Response) => {
    try {
        const { orderId, signature } = req.body;
        
        logger.info(`[WOO] Order paid webhook: ${orderId}, sig: ${signature}`);
        
        // Verify transaction on-chain
        const verified = await paymentService.verifyTransaction(signature);
        
        if (!verified) {
            return res.status(400).json({
                success: false,
                error: 'Transaction not found or invalid'
            });
        }
        
        // Mark WooCommerce order as paid
        await wooService.completeOrder(orderId, {
            transactionId: signature,
            paidAt: new Date().toISOString(),
            solscanLink: `https://solscan.io/tx/${signature}`
        });
        
        logger.info(`[WOO] Order ${orderId} marked as paid`);
        
        res.json({
            success: true,
            message: 'Order marked as paid',
            transactionId: signature
        });
        
    } catch (error) {
        logger.error('[WOO] Order paid webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to mark order as paid',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export { router as wooCommerceRoutes };

