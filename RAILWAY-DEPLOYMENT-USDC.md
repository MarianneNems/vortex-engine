# 🚀 Railway Deployment Guide - USDC System v4.1.0

**Service:** vortex-engine  
**Version:** 4.1.0  
**Architecture:** USDC-First + TOLA Incentives

---

## 📋 PRE-DEPLOYMENT CHECKLIST

- [ ] Railway account created
- [ ] GitHub repository connected
- [ ] Solana treasury wallet created
- [ ] Helius RPC API key obtained
- [ ] WordPress site URL ready
- [ ] WooCommerce API keys generated

---

## 🎯 STEP 1: CREATE RAILWAY PROJECT

### Via Railway Dashboard:

```
1. Go to: https://railway.app
2. Click: "New Project"
3. Select: "Deploy from GitHub repo"
4. Choose: MarianneNems/vortex-engine (or your repo)
5. Branch: main
6. Click: "Deploy"
```

**Railway will auto-detect:** `railway.json` configuration

---

## 🔐 STEP 2: CONFIGURE ENVIRONMENT VARIABLES

### In Railway Dashboard → Variables Tab:

**Add ALL of these:**

### Server Configuration
```
PORT=3000
NODE_ENV=production
```

### Solana Blockchain (CRITICAL)
```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
SOLANA_NETWORK=mainnet-beta
```

### Treasury Wallet (⚠️ KEEP SECURE!)
```
PLATFORM_TREASURY_PUBKEY=Your_Solana_Wallet_Public_Key
TREASURY_WALLET_PRIVATE=Your_Private_Key_Base58_Encoded
```

**🔒 SECURITY NOTE:** Never commit private keys to GitHub!

### PRIMARY: USDC (User-Facing)
```
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

### SECONDARY: TOLA (Backend Incentives)
```
TOLA_MINT=H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky
```

### WordPress Integration
```
WP_AJAX_URL=https://your-site.com/wp-admin/admin-ajax.php
WP_API_URL=https://your-site.com/wp-json
```

### WooCommerce Integration
```
WOO_BASE_URL=https://your-site.com
WOO_CONSUMER_KEY=ck_xxxxxxxxxxxxx
WOO_CONSUMER_SECRET=cs_xxxxxxxxxxxxx
WOO_WEBHOOK_SECRET=wh_secret_key
```

### Security
```
API_SECRET_KEY=random_secure_string_for_admin_api
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000
```

---

## 📊 STEP 3: VERIFY DEPLOYMENT

### Check Deployment Logs:

```
Railway Dashboard → Deployments → View Logs
```

**Look for:**
```
[VORTEX ENGINE] v4.1.0 🚀
[VORTEX ENGINE] USDC-First Payment System
✅ All systems operational - Ready for requests
```

### Test Health Endpoint:

```bash
curl https://your-vortex-engine.railway.app/health
```

**Expected response:**
```json
{
  "success": true,
  "status": "online",
  "version": "4.1.0",
  "timestamp": "2026-01-05T..."
}
```

---

## 🧪 STEP 4: TEST API ENDPOINTS

### Test USDC Balance:
```bash
curl https://your-vortex-engine.railway.app/api/usdc/balance/YOUR_WALLET_ADDRESS
```

**Expected:**
```json
{
  "success": true,
  "wallet": "YOUR_WALLET_ADDRESS",
  "balance": 0.00
}
```

### Test TOLA Balance (Incentives):
```bash
curl https://your-vortex-engine.railway.app/api/tola/balance/YOUR_WALLET_ADDRESS
```

### Test Health:
```bash
curl https://your-vortex-engine.railway.app/health
```

---

## 🔗 STEP 5: CONFIGURE WORDPRESS

### Add Railway URL to WordPress:

**Method 1: Via PHP:**
```php
update_option('vortex_railway_backend_url', 'https://your-vortex-engine.railway.app');
```

**Method 2: Via Admin:**
```
WordPress Admin → USDC System → Settings
Railway Backend URL: https://your-vortex-engine.railway.app
Save
```

---

## ✅ STEP 6: VERIFY INTEGRATION

### Test WordPress → Railway Communication:

**In WordPress admin, run this test:**
```php
// In WordPress PHP or via plugin
$railway_url = get_option('vortex_railway_backend_url');
$response = wp_remote_get($railway_url . '/health');

if (!is_wp_error($response)) {
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if ($body['success']) {
        echo '✅ Railway backend connected!';
    }
}
```

---

## 📊 RAILWAY CONFIGURATION

### railway.json Settings:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "node dist/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**✅ Already configured in your project!**

---

## 🔐 SECURITY BEST PRACTICES

### Protect Your Private Keys:

1. **Never commit to GitHub:**
   ```bash
   # Add to .gitignore (already done)
   .env
   *.pem
   *.json (wallet files)
   ```

2. **Use Railway Secret Variables:**
   - All keys stored in Railway dashboard
   - Not in code
   - Not in git

3. **Rotate Keys Regularly:**
   - Update API keys quarterly
   - Monitor for suspicious activity
   - Keep backup wallet keys secure

---

## 📈 MONITORING

### Railway Dashboard:

**Metrics Tab:**
- CPU usage
- Memory usage
- Request count
- Error rate

**Deployments Tab:**
- Deployment history
- Build logs
- Runtime logs

**Logs Tab:**
- Real-time log streaming
- Search and filter
- Error tracking

---

## 🐛 TROUBLESHOOTING

### Build Fails:

```
Check: package.json dependencies correct
Check: TypeScript compiles (npm run build locally)
Check: Node version matches (.nvmrc)
```

### Runtime Errors:

```
Check: All environment variables set
Check: Railway logs for errors
Check: Treasury wallet has SOL for fees
Check: RPC URL is valid and has rate limits
```

### WordPress Can't Connect:

```
Check: Railway URL correct in WordPress
Check: CORS enabled in server.ts
Check: Firewall/security not blocking
Check: SSL/HTTPS on both sides
```

---

## 🔄 DEPLOYMENT WORKFLOW

### Continuous Deployment:

```bash
# 1. Make changes locally
git add .
git commit -m "Update USDC system"

# 2. Push to GitHub
git push origin main

# 3. Railway auto-deploys
# (Watch dashboard for deployment status)

# 4. Verify health endpoint
curl https://your-vortex-engine.railway.app/health
```

---

## 📊 PRODUCTION CHECKLIST

Before going live:

- [ ] All environment variables configured
- [ ] Treasury wallet funded (minimum 0.1 SOL for fees)
- [ ] Treasury has USDC token account
- [ ] Treasury has TOLA token account
- [ ] Health endpoint responds
- [ ] USDC balance endpoint works
- [ ] TOLA balance endpoint works
- [ ] WordPress can connect
- [ ] Logs show no errors
- [ ] SSL/HTTPS enabled
- [ ] Rate limiting active
- [ ] Monitoring configured

---

## 🎯 WORDPRESS INTEGRATION POINTS

### Your WordPress Should Call:

**1. Get USDC Balance:**
```
GET https://your-vortex-engine.railway.app/api/usdc/balance/{wallet}
```

**2. Transfer USDC:**
```
POST https://your-vortex-engine.railway.app/api/usdc/transfer
Body: { user_id, wallet_address, amount_usdc, stripe_payment_intent }
```

**3. Verify Transaction:**
```
GET https://your-vortex-engine.railway.app/api/usdc/verify/{signature}
```

**4. Distribute TOLA Rewards (Backend):**
```
POST https://your-vortex-engine.railway.app/api/tola/transfer
Body: { user_id, wallet_address, amount_tola, reason: "subscription_reward" }
```

**5. Mint NFT with TOLA:**
```
POST https://your-vortex-engine.railway.app/api/tola/mint-nft
Body: { name, uri, wallet_address, tola_cost }
```

---

## 🎊 SUCCESS VERIFICATION

**System is deployed successfully when:**

1. ✅ Railway shows "Active" deployment
2. ✅ Health endpoint returns 200
3. ✅ USDC balance endpoint works
4. ✅ WordPress can fetch balance
5. ✅ No errors in Railway logs
6. ✅ All webhooks receiving events

**Test command:**
```bash
curl https://your-vortex-engine.railway.app/health | jq .
```

**Expected:**
```json
{
  "success": true,
  "status": "online",
  "version": "4.1.0",
  "timestamp": "2026-01-05T..."
}
```

---

## 📞 SUPPORT

**Railway Issues:**
- Check: https://railway.app/help
- Discord: https://discord.gg/railway
- Docs: https://docs.railway.app

**Vortex Engine Issues:**
- Check server logs
- Review environment variables
- Test endpoints individually
- Verify WordPress integration

---

## 🎉 DEPLOYMENT COMPLETE!

**Your vortex-engine is now:**
- ✅ Deployed on Railway
- ✅ USDC-first architecture
- ✅ TOLA incentive support
- ✅ WordPress integration
- ✅ Production ready

**Next:** Configure WordPress to use your Railway URL!

```
WordPress Admin → USDC System → Settings
Railway Backend URL: https://your-vortex-engine.railway.app
```

---

**Version:** 4.1.0  
**Updated:** January 5, 2026  
**Status:** Production Ready 🚀

