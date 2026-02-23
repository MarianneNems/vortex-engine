# VORTEX ENGINE — Integration Status & Audit Report v4.0.0
**Service:** Railway Backend (Node.js/TypeScript)
**WordPress Plugin:** vortex-ai-engine v4.0.0 at www.vortexartec.com
**Engine URL:** https://vortex-engine-production.up.railway.app
**Date:** 2026-02-23

---

## Architecture Overview

```
WordPress (Cloudways)           Railway Engine (this repo)
    vortex-ai-engine v4.0.0         vortex-engine v4.0.0
          |                                 |
          |--- POST webhooks -------------->|
          |   (order, product, balance)     |
          |                                 |--- Solana RPC (Helius)
          |<-- incoming webhook callbacks --|--- Jupiter (swap quotes)
          |   (generation-complete,         |--- Metaplex (NFT mint)
          |    transaction-confirmed,       |--- WooCommerce API
          |    balance-update)              |
          |                                 |
    HURAII (RunPod serverless)    Separate Python API (api/main.py)
    GPU image generation          Depth estimation + mesh conversion
```

---

## Implemented Routes (Engine Side)

| Route | Status | Purpose |
|---|---|---|
| GET /tola/snapshot | OK | TOLA price/liquidity from Dexscreener |
| GET /tola/quote | OK | Jupiter swap quote |
| POST /wc/webhooks/product-published | OK | Mints NFT when WC product published |
| POST /wc/webhooks/order-created | OK | Creates TOLA payment intent |
| POST /wc/webhooks/order-paid | OK | Marks order complete after on-chain confirm |
| GET /api/royalty/config | OK | 5% immutable royalty config |
| POST /api/royalty/sale | OK | Process secondary sale royalty |
| POST /api/royalty/verify-huraii | OK | Verify HURAII signature on image |
| GET /assets/daily/today | OK | Daily NFT bundle |
| POST /assets/daily/create | OK | Create daily bundle (admin) |
| GET /api/agentic/agents | OK | List all 5 AI agents |
| GET /api/agentic/status | OK | Agent health status |
| GET /balance-sync/* | OK | Balance synchronization endpoints |
| GET /cosmos/* | OK | COSMOS event system |
| GET /marketplace/* | OK | Marketplace data |
| GET /swap/* | OK | Swap game endpoints |
| GET /usdc/* | OK | USDC operations |
| GET /spending/* | OK | Spending limits |

---

## Incoming Webhooks (WordPress sends to this engine)

These are sent by `wp-content/mu-plugins/vortex-webhook-endpoints-v4.0.0.php`:

| WordPress Hook | Engine Receives At | Status |
|---|---|---|
| user_register | POST /wc/webhooks/user | OK |
| woocommerce_order_status_completed | POST /wc/webhooks/order-paid | OK |
| product publish | POST /wc/webhooks/product-published | OK |
| vortex_balance_credited | POST /wc/webhooks/balance | OK |
| vortex_nft_minted | POST /wc/webhooks/nft-minted | OK |
| vortex_wallet_connected | POST /wc/webhooks/wallet | OK |

---

## Outgoing Webhooks (Engine sends to WordPress)

The engine calls back to WordPress at:
`https://www.vortexartec.com/wp-json/vortex/v1/incoming/*`

Handled by: `includes/webhooks/class-vortex-incoming-webhook-handler-v4.0.0.php`

| Engine Fires | WordPress Receives | Status |
|---|---|---|
| generation-complete | POST /vortex/v1/incoming/generation-complete | OK |
| transaction-confirmed | POST /vortex/v1/incoming/transaction-confirmed | OK |
| balance-update | POST /vortex/v1/incoming/balance-update | OK |
| training-complete | POST /vortex/v1/incoming/training-complete | OK |

---

## HURAII Generation (NOT handled by this engine)

HURAII GPU generation goes directly from WordPress to RunPod serverless:
```
WordPress PHP -> RunPod Serverless (GPU) -> image returned directly
WordPress PHP -> DALL-E 3 (fallback) -> image returned directly
```

This engine does NOT proxy HURAII generation requests.

---

## New in WordPress Plugin v4.0.0 (Feb 2026) — No Engine Changes Required

The following were added to the WordPress plugin and do not require changes to this engine:

1. Three.js WebXR 3D viewer — browser-side only
2. Depth estimation — Python API (api/main.py) not this TypeScript engine
3. Deep reinforcement scheduler — WordPress cron, not engine
4. Telemetry instrumentation — WordPress transients
5. Workspace actions.js — frontend only

---

## Environment Variables Required (Production Railway)

```
# Core
WOO_BASE_URL=https://www.vortexartec.com
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
PLATFORM_TREASURY_PUBKEY=6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g
TOLA_MINT=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky

# WooCommerce
WOO_CONSUMER_KEY=ck_your_production_key
WOO_CONSUMER_SECRET=cs_your_production_secret
WOO_WEBHOOK_SECRET=your_webhook_hmac_secret

# Security
API_SECRET_KEY=your_admin_api_key
```

---

## IMMUTABLE Constants (NEVER change these)

```typescript
PLATFORM_ROYALTY_BPS = 500   // 5% - IMMUTABLE
PLATFORM_WALLET = "6VPLAVjote7Bqo96CbJ5kfrotkdU9BF3ACeqsJtcvH8g"
TOLA_INCENTIVE_WALLET = "EMmEk1FkUwzZnb6yTXM1HegCNdPKR4khxKQCLpiiQMCz"  // User #52
```

---

## Production Health Check

```bash
curl https://vortex-engine-production.up.railway.app/health
curl https://vortex-engine-production.up.railway.app/tola/snapshot
curl https://vortex-engine-production.up.railway.app/api/royalty/config
```

Expected: HTTP 200 with success: true on all three.
