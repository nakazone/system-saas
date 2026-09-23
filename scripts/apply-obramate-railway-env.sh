#!/usr/bin/env bash
# Apply production multi-tenant env for obramate.com.
# Prerequisites: `railway login` and `railway link` in this repo.
set -euo pipefail

ROOT_DOMAIN="${APP_ROOT_DOMAIN:-obramate.com}"
BASE_URL="${APP_BASE_URL:-https://obramate.com}"

echo "Setting Railway variables for ${ROOT_DOMAIN}…"
railway variables set \
  "APP_ROOT_DOMAIN=${ROOT_DOMAIN}" \
  "APP_BASE_URL=${BASE_URL}" \
  "TENANT_ROUTING=subdomain"

echo
echo "Done. Redeploy if Railway did not auto-restart, then run:"
echo "  npm run check:domain"
echo
echo "Also ensure Railway Networking has custom domains:"
echo "  ${ROOT_DOMAIN}"
echo "  www.${ROOT_DOMAIN}"
echo "  *.${ROOT_DOMAIN}"
echo "  admin.${ROOT_DOMAIN}"
echo
echo "And DNS at Network Solutions:"
echo "  ${ROOT_DOMAIN}  CNAME/ALIAS → <service>.up.railway.app"
echo "  www             CNAME       → ${ROOT_DOMAIN}"
echo "  *               CNAME       → <service>.up.railway.app"
