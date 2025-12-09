@echo off
echo Deploying Vortex Engine to GitHub...

git init
git add .
git commit -m "Vortex Engine v4.0.0 - TOLA WooCommerce Solana Integration"
git branch -M main
git remote add origin https://github.com/MarianneNems/vortex-engine.git
git push -u origin main

echo.
echo Done! Check GitHub and then deploy on Railway.
pause

