# Railway Deployment Guide - Vortex Engine v4.0.0

## Prerequisites

- Railway account
- GitHub repository connected
- Solana wallet with USDC

## Step 1: Install Dependencies

```bash
cd vortex-engine
npm install
```

This will install:
- `@solana/web3.js` - Solana blockchain
- `@solana/spl-token` - SPL token operations
- `bs58` - Base58 encoding for keys
- All existing dependencies

## Step 2: Build TypeScript

```bash
npm run build
```

This compiles TypeScript to JavaScript in `dist/` folder.

## Step 3: Set Environment Variables in Railway

Go to Railway dashboard → Your Project → Variables

Add these variables:

```
PORT=3000
NODE_ENV=production
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
TREASURY_WALLET_PUBLIC=<your_public_key>
TREASURY_WALLET_PRIVATE=<your_private_key_base58>
```

## Step 4: Deploy to Railway

### Option A: Auto-deploy from GitHub

1. Push changes to GitHub
2. Railway auto-deploys from `main` branch

### Option B: Manual deploy

```bash
railway up
```

## Step 5: Verify Deployment

Check Railway logs for:

```
[VORTEX ENGINE] v4.0.0 listening on port 3000
[VORTEX ENGINE] USDC API endpoints:
  - POST /api/usdc/transfer
  - GET /api/usdc/balance/:wallet
  - GET /api/usdc/verify/:signature
```

## Step 6: Test Endpoints

Get your Railway URL (e.g., `https://vortex-engine-production.up.railway.app`)

Test health:
```bash
curl https://your-railway-url.railway.app/health
```

Test USDC balance:
```bash
curl https://your-railway-url.railway.app/api/usdc/balance/YOUR_WALLET
```

## Troubleshooting

### Error: "bs58 not found"
```bash
npm install bs58
npm run build
railway up
```

### Error: "TREASURY_WALLET_PRIVATE not set"
- Check Railway environment variables
- Ensure private key is base58 encoded
- Redeploy after adding variables

### Error: "Connection refused"
- Check SOLANA_RPC_URL is set
- Try alternative RPC: `https://solana-api.projectserum.com`

## Monitoring

View logs in Railway dashboard:
- Click on your deployment
- Go to "Logs" tab
- Monitor for USDC transfer logs

## Updating

To update after code changes:

```bash
git add .
git commit -m "Update USDC integration"
git push origin main
```

Railway will auto-deploy.

## Security Checklist

- [ ] Environment variables set in Railway (not in code)
- [ ] Private keys never committed to git
- [ ] HTTPS enabled on Railway
- [ ] Webhook secrets configured
- [ ] Rate limiting enabled
- [ ] Logs monitored regularly

## Production URLs

After deployment, update WordPress with Railway URL:

In `wp-content/mu-plugins/vortex-stripe-usdc-gateway.php`:
```php
$engine_url = 'https://your-railway-url.railway.app';
```

## Support

If deployment fails:
1. Check Railway logs
2. Verify all environment variables
3. Test locally first with `npm run dev`
4. Check package.json dependencies

