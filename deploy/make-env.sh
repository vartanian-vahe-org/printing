#!/usr/bin/env bash
# Generates deploy/.env.demo for a server IP with random secrets.
# Usage: deploy/make-env.sh <server-ip> <acme-email>
# The demo password is written to deploy/.demo-credentials (git-ignored), never printed.
set -euo pipefail

IP="${1:?usage: make-env.sh <server-ip> <acme-email>}"
EMAIL="${2:?usage: make-env.sh <server-ip> <acme-email>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env.demo"
CREDS_FILE="$DIR/.demo-credentials"

if [[ -e "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists; delete it first to regenerate." >&2
  exit 1
fi

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

DOMAIN="${IP//./-}.sslip.io"
DEMO_PASSWORD="$(rand 16)"
ADMIN_PASSWORD="$(rand 20)"
HASH="$(docker run --rm caddy:2.11.7-alpine caddy hash-password --plaintext "$DEMO_PASSWORD")"

umask 077
cat >"$ENV_FILE" <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL
BASIC_AUTH_USER=demo
BASIC_AUTH_HASH='$HASH'
POSTGRES_USER=printing
POSTGRES_PASSWORD=$(rand 24)
POSTGRES_DB=printing
S3_BUCKET=printing-uploads
S3_REGION=us-west-1
S3_ACCESS_KEY_ID=printing-demo
S3_SECRET_ACCESS_KEY=$(rand 32)
ORDER_LINK_SECRET=$(rand 48)
DATA_ENCRYPTION_KEY=$(rand 48)
ADMIN_EMAIL=$EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_NAME=Admin
EOF

cat >"$CREDS_FILE" <<EOF
Demo site:   https://$DOMAIN
Demo emails: https://mail.$DOMAIN
Username:    demo
Password:    $DEMO_PASSWORD

Admin (Phase 1 step 9): $EMAIL / $ADMIN_PASSWORD
EOF

echo "Wrote $ENV_FILE and $CREDS_FILE (open the latter to see the demo password)."
