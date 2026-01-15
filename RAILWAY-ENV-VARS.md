# Railway Environment Variables - Vortex Engine v4.0.0

## Required Variables

### Blockchain Configuration
```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
TOLA_MINT=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky
```

### Treasury Wallet (CRITICAL - Keep Secret!)
```
PLATFORM_TREASURY_PUBKEY=EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz
TREASURY_WALLET_PUBLIC=EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz
TREASURY_WALLET_PRIVATE=YOUR_BASE58_PRIVATE_KEY
```

### WooCommerce Integration
```
WOO_BASE_URL=https://wordpress-1516791-5894715.cloudwaysapps.com
WOO_CONSUMER_KEY=ck_xxxxxxxxxxxx
WOO_CONSUMER_SECRET=cs_xxxxxxxxxxxx
WOO_WEBHOOK_SECRET=VortexWebhook2025SecureKey123
```

### API Security
```
API_SECRET_KEY=VortexAdmin2025ApiKey456
```

### Server Configuration
```
PORT=3000
NODE_ENV=production
```

## Optional Variables

### NVIDIA AI Integration
```
NVIDIA_API_KEY=nvapi-xxxxx
```

### WordPress AJAX
```
WP_AJAX_URL=https://yoursite.com/wp-admin/admin-ajax.php
WP_API_URL=https://yoursite.com/wp-json
```

## Notes

1. `TREASURY_WALLET_PRIVATE` is required for blockchain transactions (USDC/TOLA transfers, NFT minting)
2. Both `SOLANA_RPC_URL` and `RPC_URL` should be set (code uses both)
3. Never commit private keys to git!
