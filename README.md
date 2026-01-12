# Vortex Engine - USDC Payment System + TOLA Incentives

**Version:** 4.1.1  
**Status:** Production Ready  
**Architecture:** USDC-First with Hidden TOLA Rewards  
**Platform Wallet:** EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz (User #52)

---

## Overview

Complete blockchain backend for Vortex AI platform:
- **PRIMARY:** USDC stablecoin payments (user-facing, 1:1 USD)
- **SECONDARY:** TOLA incentive distribution (backend rewards, hidden)
- **WooCommerce** marketplace integration
- **NFT Minting** via Metaplex (uses TOLA)
- **Solana blockchain** real-time verification
- **WordPress integration** via webhooks

---

## Features

### 1. USDC Payment System (PRIMARY - User-Facing)
- ✅ USDC balance reading from Solana blockchain
- ✅ USDC transfer to user wallets
- ✅ Transaction verification on-chain
- ✅ Integration with Stripe purchases (USD → USDC)
- ✅ Real-time balance updates
- ✅ WooCommerce USDC checkout

### 2. TOLA Incentive System (SECONDARY - Backend Only)
- ✅ TOLA reward distribution (hidden from users)
- ✅ NFT minting using TOLA (appears free to users)
- ✅ Incentive balance tracking
- ✅ Automated reward triggers
- ✅ Hidden cost system for premium features

### 3. WordPress Integration
- ✅ Webhook endpoints for subscriptions
- ✅ Real-time balance synchronization
- ✅ Transaction logging to WordPress database
- ✅ User balance crediting
- ✅ Subscription activation

### 4. WooCommerce Integration
- ✅ USDC cryptocurrency checkout
- ✅ QR code + Phantom deep link
- ✅ On-chain payment verification
- ✅ Auto-complete orders
- ✅ Product-to-NFT minting (TOLA)

---

## Installation

### 1. Install Dependencies

```bash
cd vortex-engine
npm install
```

### 2. Configure Environment

Copy `env-template.txt` to `.env` and fill in:

```env
# Solana
RPC_URL=your_helius_or_quicknode_url
PLATFORM_TREASURY_PUBKEY=your_treasury_wallet_address
TOLA_MINT=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky

# WooCommerce
WOO_BASE_URL=https://vortexartec.com
WOO_CONSUMER_KEY=your_woocommerce_key
WOO_CONSUMER_SECRET=your_woocommerce_secret
WOO_WEBHOOK_SECRET=your_webhook_secret

# Security
API_SECRET_KEY=your_admin_api_key
```

### 3. Build & Run

```bash
npm run build
npm start

# Or for development:
npm run dev
```

---

## API Endpoints

### TOLA Endpoints

#### GET /tola/snapshot
Get current TOLA metrics from Dexscreener

**Response:**
```json
{
  "success": true,
  "data": {
    "price": 1.05,
    "liquidity": 125000.50,
    "volume24h": 45000.30,
    "fdv": 1050000,
    "pairAddress": "...",
    "dexId": "raydium",
    "links": {
      "dexscreener": "https://dexscreener.com/solana/...",
      "raydium": "https://raydium.io/swap/...",
      "solscan": "https://solscan.io/token/..."
    }
  }
}
```

#### GET /tola/quote
Get swap quote from Jupiter

**Parameters:**
- `inputMint` - Input token mint address
- `outputMint` - Output token mint address (TOLA)
- `amount` - Amount in lamports
- `slippageBps` - Slippage in basis points (default: 100 = 1%)

**Response:**
```json
{
  "success": true,
  "data": {
    "inAmount": "1000000000",
    "outAmount": "950000000",
    "priceImpactPct": 0.5,
    "routePlan": [...]
  }
}
```

---

### WooCommerce Webhooks

#### POST /wc/webhooks/product-published
Called when product status changes to "publish"

**Validates:** HMAC signature  
**Action:** Mints NFT on Solana  
**Updates:** WooCommerce product meta with NFT data

#### POST /wc/webhooks/order-created
Called when new order is created with TOLA Pay

**Action:** Creates payment intent with QR code

#### POST /wc/webhooks/order-paid
Called after on-chain payment confirmation

**Action:** Marks WooCommerce order as completed

---

### Assets Endpoints

#### POST /assets/daily/create
Create today's daily platform asset bundle (Admin only)

**Headers:** `X-API-Key: your_secret_key`

**Response:**
```json
{
  "success": true,
  "data": {
    "day": "2025-12-09",
    "bundleMint": "...",
    "bundleTx": "...",
    "componentMints": ["...", "..."],
    "sku": "DAILY-20251209"
  }
}
```

#### GET /assets/daily/today
Get today's bundle (if exists)

#### GET /assets/products
List all products with NFT status

---

## WordPress Integration

### Upload These Files:

1. **wp-content/mu-plugins/vortex-engine-database-bridge.php**
   - Database bridge for engine
   - AJAX handlers
   - Auto-creates tables

2. **wp-content/plugins/vortex-tola-pay/vortex-tola-pay.php**
   - WooCommerce payment gateway
   - QR code checkout page
   - Status polling

3. **wp-content/mu-plugins/vortex-tola-security-tracker.php**
   - Security confirmations
   - Activity tracking
   - Transaction logging

4. **assets/js/vortex-tola-security.js**
   - Frontend security dialogs
   - Balance monitoring
   - Activity tracker UI

---

## WooCommerce Setup

### 1. Activate Plugin
- Go to: Plugins → Installed Plugins
- Activate: "Vortex TOLA Pay Gateway"

### 2. Configure Gateway
- Go to: WooCommerce → Settings → Payments
- Enable: "TOLA Pay"
- Configure:
  - Title: "TOLA Cryptocurrency"
  - Engine URL: http://your-engine-url:3000

### 3. Setup Webhooks
Go to: WooCommerce → Settings → Advanced → Webhooks

Create 3 webhooks:

**Webhook 1:** Product Updated
- Name: Vortex Product Published
- Status: Active
- Topic: Product updated
- Delivery URL: http://your-engine:3000/wc/webhooks/product-published
- Secret: your_webhook_secret

**Webhook 2:** Order Created
- Name: Vortex Order Created
- Status: Active
- Topic: Order created
- Delivery URL: http://your-engine:3000/wc/webhooks/order-created
- Secret: your_webhook_secret

**Webhook 3:** Order Paid (Custom)
- Will be triggered by engine after payment verification

---

## Frontend Integration

### Existing index.html Tabs

The system integrates seamlessly with existing tabs in `assets/interface-crypto/index.html`:

**Wallet Tab:**
- Activity tracker auto-injects
- Shows all TOLA transactions
- Real-time balance monitoring

**No modifications needed** - system adds features without changing existing code.

---

## Security Features

### 1. Purchase Confirmations
- All TOLA transactions require confirmation
- Shows amount, balance before/after
- Prevents accidental purchases
- Insufficient funds protection

### 2. HMAC Validation
- All WooCommerce webhooks validated
- Crypto signatures required
- Prevents unauthorized requests

### 3. Rate Limiting
- 100 requests per 15 minutes per IP
- Prevents abuse
- Configurable limits

### 4. Transaction Logging
- Every TOLA change logged
- IP address recorded
- Full audit trail
- Real-time activity tracking

---

## Database Tables

Auto-created on first run:

### wp_vortex_product_assets
Stores product → NFT mappings

### wp_vortex_daily_bundles
Stores daily grouped NFT bundles

### wp_vortex_payment_intents
Stores TOLA payment intents

### wp_vortex_balance_activity
Logs all balance changes (from security tracker)

### wp_vortex_tola_transactions
Logs all TOLA transactions (from security tracker)

---

## Testing

### 1. Test TOLA Metrics

```bash
curl http://localhost:3000/tola/snapshot
```

### 2. Test Jupiter Quote

```bash
curl "http://localhost:3000/tola/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky&amount=1000000000&slippageBps=100"
```

### 3. Test Product Publishing

1. Create draft WooCommerce product
2. Add image, price, description
3. Click "Publish"
4. Check engine logs for NFT mint
5. Verify product meta has: vortex_nft_mint, vortex_mint_tx

### 4. Test TOLA Payment

1. Add product to cart
2. Go to checkout
3. Select "TOLA Pay"
4. Complete checkout
5. See QR code + Phantom link
6. Pay with Phantom
7. Order auto-completes

---

## Monitoring & Logs

### Engine Logs
```bash
# Watch logs
tail -f logs/vortex-engine.log

# Check for errors
grep ERROR logs/vortex-engine.log
```

### WordPress Logs
```bash
# Check wp-content/debug.log
tail -f wp-content/debug.log | grep VORTEX
```

### Solana Transactions
- View on Solscan: https://solscan.io/
- View on Solana Explorer: https://explorer.solana.com/

---

## Architecture

```
WordPress/WooCommerce
    ↓ (Webhooks)
Vortex Engine (Node/TypeScript)
    ↓ (Solana RPC)
Solana Blockchain
    ↓ (Jupiter/Metaplex)
TOLA Token & NFTs
```

---

## Troubleshooting

### Engine won't start
- Check .env file exists and is configured
- Verify RPC_URL is valid
- Check port 3000 is available

### Webhooks not received
- Verify webhook URLs in WooCommerce
- Check HMAC secret matches
- Review engine logs for validation errors

### NFT minting fails
- Check Platform Wallet keypair is configured
- Verify RPC connection
- Ensure sufficient SOL for rent

### Payment not confirming
- Check transaction on Solscan
- Verify TOLA sent to correct treasury ATA
- Review payment intent status in database

---

## Production Checklist

- [ ] Environment variables configured
- [ ] Platform Wallet secured (hardware/multisig)
- [ ] RPC endpoint has rate limits/caching
- [ ] Webhooks registered in WooCommerce
- [ ] TOLA Pay gateway activated
- [ ] Database tables created
- [ ] SSL/HTTPS enabled
- [ ] Rate limiting configured
- [ ] Monitoring/alerting setup
- [ ] Backup strategy in place

---

## Version History

**4.0.0** (Dec 9, 2025)
- Initial release
- TOLA metrics & quotes
- NFT minting on product publish
- Daily bundle creation
- TOLA Pay checkout
- Security confirmations
- Activity tracking

---

## Support

For issues or questions:
- Check logs first
- Review documentation
- Test endpoints individually
- Verify webhooks received
- Check database tables

---

## License

Proprietary - Vortex AI Engine
Version 4.0.0

