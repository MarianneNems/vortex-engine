# USDC Environment Setup for Vortex Engine v4.1.0

## Complete Environment Variables for USDC-First System

Add these to your Railway dashboard or `.env` file:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Solana Blockchain
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
SOLANA_NETWORK=mainnet-beta

# Treasury Wallet (CRITICAL - Secure These!)
PLATFORM_TREASURY_PUBKEY=<your_solana_wallet_public_key>
TREASURY_WALLET_PRIVATE=<your_solana_wallet_private_key_base58>

# PRIMARY: USDC Configuration (User-Facing Currency)
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# SECONDARY: TOLA Configuration (Backend Incentives)
TOLA_MINT=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky

# WordPress Integration
WP_AJAX_URL=https://your-wordpress-site.com/wp-admin/admin-ajax.php
WP_API_URL=https://your-wordpress-site.com/wp-json

# WooCommerce Integration
WOO_BASE_URL=https://your-wordpress-site.com
WOO_CONSUMER_KEY=ck_your_key_here
WOO_CONSUMER_SECRET=cs_your_secret_here
WOO_WEBHOOK_SECRET=your_webhook_secret

# Security
API_SECRET_KEY=your_admin_api_secret_key
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000
```

## How to Get Your Wallet Keys

### Using Solana CLI:

```bash
# Generate new wallet
solana-keygen new --outfile ~/usdc-treasury.json

# Get public key
solana-keygen pubkey ~/usdc-treasury.json

# Get private key (base58 encoded)
cat ~/usdc-treasury.json | jq -r '.[0:32] | @base64'
```

### Using Phantom Wallet:

1. Export your private key from Phantom
2. Convert to base58 format
3. Use as TREASURY_WALLET_PRIVATE

## USDC Mint Address

**Mainnet USDC:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`  
**Devnet USDC:** `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`

## Security Notes

- Never commit private keys to git
- Use environment variables only
- Keep treasury wallet secure
- Monitor transaction logs
- Use separate wallet for testing

## Testing

After setting environment variables:

```bash
# Test USDC transfer
curl -X POST http://localhost:3000/api/usdc/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "wallet_address": "YOUR_TEST_WALLET",
    "amount_usdc": 1.0,
    "stripe_payment_intent": "pi_test_123",
    "stripe_session_id": "cs_test_123"
  }'

# Test balance check
curl http://localhost:3000/api/usdc/balance/YOUR_WALLET_ADDRESS
```

## Railway Deployment

1. Go to Railway dashboard
2. Select your vortex-engine project
3. Go to Variables tab
4. Add all USDC environment variables
5. Redeploy

## Verification

Check logs for:
```
[VORTEX ENGINE] USDC API endpoints:
  - POST /api/usdc/transfer (Transfer USDC to wallet)
  - GET /api/usdc/balance/:wallet (Get USDC balance)
  - GET /api/usdc/verify/:signature (Verify transaction)
```

