# VORTEX ECOSYSTEM AUDIT v4.0.0

## CONSOLIDATED HOOKS, WEBHOOKS, AND ENDPOINTS

Generated: January 11, 2026
Version: 4.1.1

---

## 1. WALLET CONFIGURATION

### Platform Wallets (Each has a specific purpose)

| Wallet | Address | Purpose | Share |
|--------|---------|---------|-------|
| **Platform Commission** | `6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g` | 15% marketplace commissions from WCFM/WooCommerce | 15% |
| **TOLA Incentive (User #52)** | `EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz` | Distributes TOLA rewards to users | Variable |
| **Market Treasury** | `GYrv6jREdH2Rajd93AtxCghotazKXt6qwxNZtyL6ssp2` | Operations, liquidity, USDC disbursements | Operational |
| **Contract Owner** | `DrdrYs68TFgkiNP2y6mQJD8c3Q8DbRPRyjsYvL5oCQ6u` | NFT smart contract royalties (immutable) | 5% |
| **Wallet Management** | `3c6v1xUqkve8kLLyMQkVraqRGCWo4UmY7QLa185nR9Fx` | Fee on TOLA purchases via Stripe | 0.5% |
| **Operator/Minter** | `FPiwDDtdU2G5y3pi7TX3eWAzZJoQ2mPecv42iBz9xUB3` | Creator + seller royalties | Up to 15% |

### Token Addresses

| Token | Mint Address |
|-------|--------------|
| **USDC** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| **TOLA** | `H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky` |

### API Configuration

| Setting | Value |
|---------|-------|
| **Helius API Key** | `661daee0-4ebb-4bbd-83be-45b132d734d0` |
| **Helius RPC** | `https://mainnet.helius-rpc.com/?api-key=661daee0-4ebb-4bbd-83be-45b132d734d0` |

---

## 2. FEE STRUCTURE

### TOLA-ART (First Sale)
| Fee Type | Percentage | USDC Amount (900 base) |
|----------|------------|------------------------|
| Creator Royalty | 5% | On-chain perpetual |
| Marketplace Fee | 15% | 135 USDC |
| Artist Share | 85% | 765 USDC |

### TOLA-ART (Resale)
| Fee Type | Percentage |
|----------|------------|
| Artist Share | 15% |
| Previous Owner | 65% |
| Creator Royalty | 5% (on-chain) |
| Marketplace | 15% |

### TOLA Incentive Rates (v4.0.0)

#### Welcome Bonuses (One-Time)
| Tier Level | TOLA Amount |
|------------|-------------|
| Founding Pro Artist (Pro Artist, Studio, Maverick, Enterprise) | 30,000 |
| Creator Tier (Standard, Essential, Premium, Collector) | 10,000 |

#### Activity Rewards
| Action | TOLA Amount |
|--------|-------------|
| Image Generation | 10 |
| Artwork Upload | 10 |
| Token Swap | 10 |
| Marketplace Sale | 7,000 |
| Referral Bonus | 1,000 |
| Daily Login | 10 |

#### Hold Period
All earned TOLA is held until platform reaches 1,000 registered users.
After milestone: TOLA usable for any platform service (subscriptions, GPU hours, etc.)

#### Top Artist Recognition
Highest-ranking artists invited to exhibit at Miami Art Week / Art Basel Miami Beach.

### TOLA Costs
| Action | TOLA Amount |
|--------|-------------|
| NFT Mint | 10.00 |
| Premium Filter | 2.00 |
| Priority Queue | 1.00 |
| Exclusive Model | 5.00 |

---

## 3. REST API ENDPOINTS

### Plugin Sync Endpoints
```
POST /wp-json/plugin-sync/v1/ping
GET  /wp-json/plugin-sync/v1/status
GET  /wp-json/vortex-ai/v1/supervisor/status
```

### Vortex Core Endpoints
```
POST /wp-json/vortex/v1/generate-art
POST /wp-json/vortex/v1/process-transaction
GET  /wp-json/vortex/v1/get-metrics
POST /wp-json/vortex/v1/stripe/webhook
```

### One Heartbeat Master Endpoints
```
GET  /wp-json/vortex/v1/one-heartbeat/status
GET  /wp-json/vortex/v1/one-heartbeat/health
```

---

## 4. AJAX ENDPOINTS

### Engine Database Bridge
```php
// Product Assets
add_action('wp_ajax_vortex_save_product_asset', ...)
add_action('wp_ajax_nopriv_vortex_save_product_asset', ...)
add_action('wp_ajax_vortex_get_product_asset', ...)
add_action('wp_ajax_nopriv_vortex_get_product_asset', ...)
add_action('wp_ajax_vortex_get_today_assets', ...)
add_action('wp_ajax_nopriv_vortex_get_today_assets', ...)
add_action('wp_ajax_vortex_get_all_product_assets', ...)
add_action('wp_ajax_nopriv_vortex_get_all_product_assets', ...)

// Daily Bundles
add_action('wp_ajax_vortex_save_daily_bundle', ...)
add_action('wp_ajax_nopriv_vortex_save_daily_bundle', ...)
add_action('wp_ajax_vortex_get_daily_bundle', ...)
add_action('wp_ajax_nopriv_vortex_get_daily_bundle', ...)

// Payment Intents
add_action('wp_ajax_vortex_save_payment_intent', ...)
add_action('wp_ajax_nopriv_vortex_save_payment_intent', ...)
add_action('wp_ajax_vortex_get_payment_intent', ...)
add_action('wp_ajax_nopriv_vortex_get_payment_intent', ...)
add_action('wp_ajax_vortex_update_payment_intent', ...)
add_action('wp_ajax_nopriv_vortex_update_payment_intent', ...)
```

### Wallet Balance Endpoints
```php
add_action('wp_ajax_vortex_get_user_wallet_info', ...)
add_action('wp_ajax_vortex_get_accurate_balances', ...)
add_action('wp_ajax_vortex_refresh_usdc_balance', ...)
```

### TOLA Incentive Manager
```php
add_action('wp_ajax_vortex_check_mint_credits', ...)
add_action('wp_ajax_vortex_mint_nft_with_incentive', ...)
```

### TOLA-ART Automation
```php
add_action('wp_ajax_vortex_save_tola_art_prompt', ...)
add_action('wp_ajax_vortex_get_scheduled_prompts', ...)
add_action('wp_ajax_vortex_trigger_tola_art_generation', ...)
add_action('wp_ajax_vortex_test_tola_art_connection', ...)
```

---

## 5. WORDPRESS HOOKS

### Stripe Integration
```php
add_action('rest_api_init', 'register_endpoint')  // /vortex/v1/stripe/webhook
add_filter('woocommerce_stripe_request_body', 'add_metadata_to_requests', 10, 2)
```

### TOLA Blockchain Bridge
```php
add_action('vortex_tola_purchased', 'vortex_execute_blockchain_tola_transfer', 10, 3)
add_action('vortex_usdc_purchased', 'vortex_convert_usdc_to_tola', 10, 3)
```

### TOLA Incentive System
```php
add_action('vortex_subscription_created', 'reward_subscription', 10, 2)
add_action('vortex_image_generated', 'reward_image_generation', 10, 1)
add_action('wp_login', 'reward_daily_login', 10, 2)
add_action('vortex_image_generated', 'check_milestones', 10, 1)
add_action('vortex_tola_incentive_added', ...) // Custom trigger
```

### TOLA-ART Automation
```php
add_action('init', 'init', 10)
add_action('admin_menu', 'add_admin_menu', 99)
add_action('admin_init', 'register_settings')
add_action('woocommerce_init', 'setup_woocommerce_category')
add_action('woocommerce_product_options_general_product_data', 'add_product_fields')
add_action('woocommerce_process_product_meta', 'save_product_fields')
add_filter('wcfm_product_manage_fields_general', 'add_wcfm_fields', 50, 2)
add_action('vortex_tola_art_daily_generation', 'execute_daily_generation')
add_action('woocommerce_order_status_completed', 'handle_sale', 10, 1)
add_action('vortex_deliver_tola_incentive', 'deliver_incentive', 10, 3)
```

### Ecosystem Integration
```php
add_action('gform_after_submission', 'vortex_sync_to_woocommerce', 30, 2)
add_action('gform_after_submission', 'vortex_sync_to_wcfm', 40, 2)
add_action('woocommerce_checkout_create_order', ..., 10, 2)
add_action('wcfm_product_manage_after_save', ..., 10, 2)
add_filter('woocommerce_related_products', ..., 10, 3)
```

### One Heartbeat Master
```php
add_action('plugins_loaded', 'verify_heartbeat', 999)
add_action('admin_init', 'check_system_health')
add_action('rest_api_init', 'register_master_endpoints')
add_filter('vortex_mint_metadata', 'enforce_royalty_metadata', 1, 2)
add_action('vortex_before_mint', 'verify_royalty_before_mint', 1, 2)
add_filter('vortex_user_data_access', 'validate_data_access', 1, 3)
add_action('init', 'wire_missing_hooks', 99)
```

### Webhook Integration Loader
```php
// WooCommerce hooks
'register_woocommerce_hooks'

// Stripe hooks  
'register_stripe_hooks'

// Balance hooks
'register_balance_hooks'

// User journey hooks
'register_user_journey_hooks'

// Real-time sync hooks
'register_realtime_sync_hooks'

// AJAX spending handlers
'register_spending_ajax_handlers'

// WCFM vendor hooks
'register_wcfm_hooks'
```

---

## 6. RAILWAY/NODE.JS BACKEND ENDPOINTS

### Health & Status
```
GET  /health
GET  /tola/snapshot
GET  /tola/payments/status/:orderId
```

### USDC System
```
POST /api/usdc/transfer
GET  /api/usdc/balance/:wallet
GET  /api/usdc/verify/:signature
```

### TOLA System
```
POST /api/tola/transfer
GET  /api/tola/balance/:wallet
GET  /api/tola/verify/:signature
```

### NFT Minting
```
POST /api/tola/mint-nft
POST /api/tola/upload-metadata
POST /api/tola/transfer-nft
GET  /api/tola/nft/:mint_address
```

### TOLA Masterpiece
```
POST /api/tola-masterpiece/distribute-royalty
POST /api/tola-masterpiece/verify-secondary-sale
GET  /api/tola-masterpiece/status
POST /api/tola-masterpiece/webhook/created
POST /api/tola-masterpiece/webhook/sold
```

### Assets
```
POST /api/assets/daily/create
GET  /api/assets/daily/today
GET  /api/assets/products
```

### Spending Tracking
```
POST /api/spending/record
POST /api/spending/earning
GET  /api/spending/history/:user_id
GET  /api/spending/summary/:user_id
GET  /api/spending/earnings/:user_id
POST /api/spending/webhook
```

### NFT Swap
```
POST /api/swap/execute
POST /api/swap/execute-collection
GET  /api/swap/verify/:swap_id
GET  /api/swap/fees
POST /api/swap/webhook/completed
```

### AI Evolution
```
POST /api/evolution/scaling/start
POST /api/evolution/scaling/complete
GET  /api/evolution/scaling/status
POST /api/evolution/genetic/update
POST /api/evolution/genetic/fitness
GET  /api/evolution/genetic/status
POST /api/evolution/models/discovered
POST /api/evolution/models/integrate
GET  /api/evolution/models/status
POST /api/evolution/thinking/record
GET  /api/evolution/thinking/status
POST /api/evolution/observatory/metric
GET  /api/evolution/observatory/levels
GET  /api/evolution/observatory/metrics
GET  /api/evolution/status
POST /api/evolution/webhook/wordpress
```

### Agentic AI
```
POST /api/agentic/route
POST /api/agentic/classify
GET  /api/agentic/agents
POST /api/agentic/execute
POST /api/agentic/nvidia/chat
POST /api/agentic/nvidia/embed
GET  /api/agentic/nvidia/models
POST /api/agentic/pipeline/execute
GET  /api/agentic/pipeline/status
POST /api/agentic/webhook/wordpress
```

### Cosmos AI
```
POST /api/cosmos/robot/:id/connect
POST /api/cosmos/robot/:id/heartbeat
POST /api/cosmos/robot/:id/disconnect
GET  /api/cosmos/robot/:id/status
POST /api/cosmos/robot/:id/command
POST /api/cosmos/robot/:id/sensor
POST /api/cosmos/robot/:id/speak
POST /api/cosmos/robot/:id/move
POST /api/cosmos/robot/:id/create
GET  /api/cosmos/user/:id/export
POST /api/cosmos/transaction/initiate
POST /api/cosmos/transaction/:id/confirm
```

### Balance Sync
```
POST /api/sync/balance
GET  /api/sync/status/:user_id
```

---

## 7. WOOCOMMERCE WEBHOOKS

### Product Webhooks
```
POST /wc/webhooks/product-published
```

### Order Webhooks
```
POST /wc/webhooks/order-created
POST /wc/webhooks/order-paid
```

### Wallet Webhooks
```
POST /wc/webhooks/wallet-connected
POST /wc/webhooks/tola-transaction
```

### Subscription Webhooks
```
POST /wc/webhooks/subscription-activated
POST /wc/webhooks/collector-subscription
```

### Usage Webhooks
```
POST /wc/webhooks/usage-payment
```

### NFT Webhooks
```
POST /wc/webhooks/nft-minted
```

### Atelier Lab Webhooks
```
POST /wc/webhooks/generation-completed
POST /wc/webhooks/style-transfer
POST /wc/webhooks/artwork-saved
POST /wc/webhooks/product-listed
POST /wc/webhooks/huraii-vision
POST /wc/webhooks/style-guided-generation
```

---

## 8. DATABASE TABLES

### Core Tables
```sql
wp_vortex_product_assets        -- Product to NFT mappings
wp_vortex_daily_bundles         -- Daily grouped NFT bundles  
wp_vortex_payment_intents       -- TOLA payment intents
wp_vortex_tola_transactions     -- TOLA transaction logs
wp_vortex_tola_rewards          -- TOLA incentive rewards
wp_vortex_usdc_transactions     -- USDC purchase/spending logs
wp_vortex_blockchain_transactions -- Blockchain TX signatures
wp_vortex_usdc_tola_conversions -- USDC to TOLA conversion logs
```

---

## 9. USDC PACKAGES

| Package | USDC Amount | USD Price |
|---------|-------------|-----------|
| Starter | 10 | $10.00 |
| Basic | 25 | $25.00 |
| Popular | 50 | $50.00 |
| Professional | 100 | $100.00 |
| Enterprise | 250 | $250.00 |

---

## 10. CRON SCHEDULES

### TOLA-ART Daily Generation
```php
add_action('vortex_tola_art_daily_generation', 'execute_daily_generation')
// Scheduled: Daily at 00:00 Miami/Eastern Time
```

---

## 11. CUSTOM ACTIONS/FILTERS

### Balance Actions
```php
do_action('vortex_balance_updated', $user_id, $amount, $type)
do_action('vortex_tola_incentive_added', $user_id, $amount, $reason)
do_action('vortex_tola_purchased', $user_id, $tola_amount, $stripe_session_id)
do_action('vortex_usdc_purchased', $user_id, $usdc_amount, $stripe_session_id)
```

### NFT Actions
```php
do_action('vortex_before_mint', $user_id, $metadata)
do_action('vortex_deliver_tola_incentive', $user_id, $amount, $metadata)
```

### Royalty Filters
```php
apply_filters('vortex_mint_metadata', $metadata, $user_id)
apply_filters('vortex_user_data_access', $allowed, $user_id, $data_type)
apply_filters('vortex_usdc_to_tola_rate', 1.0)
```

---

## 12. MU-PLUGINS ACTIVE

### Critical MU-Plugins
- `vortex-tola-art-automation.php` - TOLA-ART loader
- `class-vortex-tola-incentive-manager.php` - Incentive system
- `vortex-engine-database-bridge.php` - Railway bridge
- `vortex-tola-blockchain-bridge.php` - Solana bridge
- `vortex-stripe-usdc-gateway.php` - Stripe USDC purchases
- `vortex-ecosystem-integration.php` - System connector
- `vortex-one-heartbeat-v4.0.0.php` - Master orchestrator

---

## 13. ENVIRONMENT VARIABLES (Railway)

```env
PORT=3000
NODE_ENV=production
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=661daee0-4ebb-4bbd-83be-45b132d734d0
SOLANA_NETWORK=mainnet-beta

# Wallet Structure (each wallet has a specific purpose)
PLATFORM_COMMISSION_WALLET=6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g
TOLA_INCENTIVE_WALLET=EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz
MARKET_TREASURY_WALLET=GYrv6jREdH2Rajd93AtxCghotazKXt6qwxNZtyL6ssp2
CONTRACT_OWNER_WALLET=DrdrYs68TFgkiNP2y6mQJD8c3Q8DbRPRyjsYvL5oCQ6u
WALLET_MANAGEMENT_WALLET=3c6v1xUqkve8kLLyMQkVraqRGCWo4UmY7QLa185nR9Fx
OPERATOR_MINTER_WALLET=FPiwDDtdU2G5y3pi7TX3eWAzZJoQ2mPecv42iBz9xUB3

# Treasury private key for automated distributions
TREASURY_WALLET_PRIVATE=[Your Base58 Private Key]

# Token addresses
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
TOLA_MINT=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky

# NFT Configuration
BUNDLR_ADDRESS=https://node1.bundlr.network
NFT_ROYALTY_BPS=500
PLATFORM_TREASURY_PUBKEY=GYrv6jREdH2Rajd93AtxCghotazKXt6qwxNZtyL6ssp2

# WordPress Integration
WP_BASE_URL=https://vortexartec.com
WP_AJAX_URL=https://vortexartec.com/wp-admin/admin-ajax.php
WP_API_URL=https://vortexartec.com/wp-json
```

---

## 14. CONSTANTS (WordPress)

```php
// TOLA-ART Configuration
define('VORTEX_TOLA_ART_OWNER_ID', 52);
define('VORTEX_TOLA_ART_WALLET', 'EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz');
define('VORTEX_TOLA_ART_CREATOR_ROYALTY', 5);
define('VORTEX_TOLA_ART_MARKETPLACE_FEE', 15);
define('VORTEX_TOLA_ART_ARTIST_SHARE', 85);
define('VORTEX_TOLA_ART_RESALE_ARTIST_SHARE', 15);
define('VORTEX_TOLA_ART_RESALE_OWNER_SHARE', 65);
define('VORTEX_TOLA_ART_CATEGORY_SLUG', 'tola-art');

// Incentive Configuration
define('VORTEX_INCENTIVE_WALLET', 'EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz');
define('VORTEX_INCENTIVE_OWNER_ID', 52);

// Helius/Blockchain Configuration
define('VORTEX_HELIUS_RPC', 'https://mainnet.helius-rpc.com/?api-key=661daee0-4ebb-4bbd-83be-45b132d734d0');
define('VORTEX_HELIUS_API_KEY', '661daee0-4ebb-4bbd-83be-45b132d734d0');
```

---

## 15. FILE DEPENDENCIES

### Railway Backend (vortex-engine)
- `/src/server.ts` - Main server
- `/src/services/usdc-transfer.service.ts` - USDC transfers
- `/src/services/tola-transfer.service.ts` - TOLA transfers
- `/src/services/tola-nft-mint.service.ts` - NFT minting
- `/src/routes/tola-masterpiece.routes.ts` - Daily art
- `/src/routes/agentic.routes.ts` - HURAII routing
- `/src/routes/balance-sync.routes.ts` - Balance sync

### WordPress Plugin Classes
- `/includes/class-vortex-rest-endpoints.php`
- `/includes/class-vortex-api-endpoints.php`
- `/includes/class-vortex-stripe-webhook.php`
- `/includes/integrations/class-vortex-webhook-integration-loader.php`
- `/includes/ajax/class-vortex-wallet-balance-endpoints.php`
- `/includes/tola-art/class-vortex-tola-art-automation-v4.php`

---

**AUDIT COMPLETE - All hooks, webhooks, and endpoints documented**
