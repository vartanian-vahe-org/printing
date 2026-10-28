#!/usr/bin/env bash
# Generates deploy/.env.demo for a server IP with random secrets.
#
#   deploy/make-env.sh <server-ip> <admin-email>                         all-in-one: everything on EC2
#   deploy/make-env.sh <server-ip> <admin-email> <web-url> <admin-url>   split: sites on Vercel (deploy/VERCEL.md)
#
# Passwords go to deploy/.demo-credentials and, in the split layout, the values to enter in the two
# Vercel projects go to deploy/.vercel-env. Both are git-ignored; nothing secret is printed.
set -euo pipefail

USAGE="usage: make-env.sh <server-ip> <admin-email> [<web-url> <admin-url>]"
IP="${1:?$USAGE}"
EMAIL="${2:?$USAGE}"
WEB_URL="${3:-}"
ADMIN_URL="${4:-}"
if [[ -n "$WEB_URL" && -z "$ADMIN_URL" ]]; then echo "$USAGE" >&2; exit 1; fi
for url in "$WEB_URL" "$ADMIN_URL"; do
  if [[ -n "$url" && "$url" != https://* ]]; then echo "Site URLs must start with https:// ($url)" >&2; exit 1; fi
done
WEB_URL="${WEB_URL%/}"
ADMIN_URL="${ADMIN_URL%/}"

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env.demo"
CREDS_FILE="$DIR/.demo-credentials"
VERCEL_FILE="$DIR/.vercel-env"

if [[ -e "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists; delete it first to regenerate." >&2
  exit 1
fi

# `|| true`: tr exits on SIGPIPE once head has enough, which pipefail would treat as a failure.
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "$1" || true; }

DOMAIN="${IP//./-}.sslip.io"
DEMO_PASSWORD="$(rand 16)"
ADMIN_PASSWORD="$(rand 20)"
PROXY_SECRET="$(rand 48)"
HASH="$(docker run --rm caddy:2.11.7-alpine caddy hash-password --plaintext "$DEMO_PASSWORD")"

umask 077
{
  if [[ -n "$WEB_URL" ]]; then
    echo "# Split layout: storefront and admin on Vercel, this server runs the API (deploy/VERCEL.md)."
    echo "DEPLOY_MODE=split"
    echo "CADDYFILE=Caddyfile.backend"
    echo "WEB_URL=$WEB_URL"
    echo "ADMIN_URL=$ADMIN_URL"
    echo "SITE_URLS=$WEB_URL,$ADMIN_URL"
    echo "API_PROXY_SECRET=$PROXY_SECRET"
  else
    echo "# All-in-one layout: storefront and admin run on this server too."
    echo "DEPLOY_MODE=all-in-one"
    echo "COMPOSE_PROFILES=sites"
    echo "CADDYFILE=Caddyfile"
  fi
  echo "DOMAIN=$DOMAIN"
  echo "BASIC_AUTH_USER=demo"
  echo "BASIC_AUTH_HASH='$HASH'"
  echo "POSTGRES_USER=printing"
  echo "POSTGRES_PASSWORD=$(rand 24)"
  echo "POSTGRES_DB=printing"
  echo "S3_BUCKET=printing-uploads"
  echo "S3_REGION=us-west-1"
  echo "S3_ACCESS_KEY_ID=printing-demo"
  echo "S3_SECRET_ACCESS_KEY=$(rand 32)"
  echo "ORDER_LINK_SECRET=$(rand 48)"
  echo "DATA_ENCRYPTION_KEY=$(rand 48)"
  echo "ADMIN_EMAIL=$EMAIL"
  echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
  echo "ADMIN_NAME=Admin"
} >"$ENV_FILE"

if [[ -n "$WEB_URL" ]]; then
  cat >"$CREDS_FILE" <<CREDS
Storefront:  $WEB_URL
Admin:       $ADMIN_URL
Demo emails: https://mail.$DOMAIN   (username and password below)
Username:    demo
Password:    $DEMO_PASSWORD

Admin sign-in: $EMAIL / $ADMIN_PASSWORD
CREDS
  cat >"$VERCEL_FILE" <<VERCEL
# Environment variables for the two Vercel projects (Settings > Environment Variables, Production).
# Contains secrets: keep this file private and never commit it.

## Storefront project (Root Directory: apps/web)
NEXT_PUBLIC_API_URL=/api
API_ORIGIN=https://api.$DOMAIN
API_INTERNAL_URL=https://api.$DOMAIN
API_PROXY_SECRET=$PROXY_SECRET
# Optional: password-protect the whole storefront with the demo password.
# SITE_BASIC_AUTH=demo:$DEMO_PASSWORD
SITE_NOINDEX=true
# Optional: hide features not ready to show yet (account, cart); see deploy/VERCEL.md.
# NEXT_PUBLIC_HIDDEN_FEATURES=account,cart

## Admin project (Root Directory: apps/admin)
VITE_API_URL=/api
VITE_STOREFRONT_URL=$WEB_URL/business-cards
# Optional: hide admin pages not ready to show (apps/admin/.env.production sets it); see deploy/VERCEL.md.
# VITE_HIDDEN_FEATURES=orders,settings,staff,activity
API_ORIGIN=https://api.$DOMAIN
API_PROXY_SECRET=$PROXY_SECRET
VERCEL
  echo "Wrote $ENV_FILE, $CREDS_FILE and $VERCEL_FILE (values to enter in the Vercel projects)."
else
  cat >"$CREDS_FILE" <<CREDS
Demo site:   https://$DOMAIN
Admin:       https://admin.$DOMAIN
Demo emails: https://mail.$DOMAIN
Username:    demo
Password:    $DEMO_PASSWORD

Admin sign-in: $EMAIL / $ADMIN_PASSWORD
CREDS
  echo "Wrote $ENV_FILE and $CREDS_FILE (open the latter to see the demo password)."
fi
