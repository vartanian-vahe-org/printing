#!/usr/bin/env bash
# Copies the repo to the demo server and (re)builds + starts the stack there.
# Usage: DEPLOY_HOST=<ip> DEPLOY_KEY=<path-to-pem> deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST to the server IP}"
KEY="${DEPLOY_KEY:?set DEPLOY_KEY to the SSH private key path}"
USER_NAME="${DEPLOY_USER:-ubuntu}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$USER_NAME@$HOST")

[[ -f "$ROOT/deploy/.env.demo" ]] || { echo "Missing deploy/.env.demo (run deploy/make-env.sh first)" >&2; exit 1; }
# The layout lives in .env.demo: COMPOSE_PROFILES=sites (all-in-one) also builds the storefront and admin.
MODE="$(sed -n 's/^DEPLOY_MODE=//p' "$ROOT/deploy/.env.demo")"
echo "==> Layout: ${MODE:-all-in-one}"

echo "==> Syncing code to $HOST"
rsync -az --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude '.git/' --exclude 'node_modules/' --exclude '**/node_modules/' \
  --exclude '.next/' --exclude '**/dist/' --exclude '.turbo/' --exclude '.env' \
  --exclude 'deploy/.demo-credentials' --exclude 'deploy/.vercel-env' --exclude '**/__pycache__/' \
  "$ROOT/" "$USER_NAME@$HOST:~/printing/"

echo "==> Building and starting containers (first build takes several minutes)"
"${SSH[@]}" 'cd ~/printing && sudo docker compose -f deploy/docker-compose.demo.yml --env-file deploy/.env.demo up -d --build --remove-orphans'

echo "==> Status"
"${SSH[@]}" 'cd ~/printing && sudo docker compose -f deploy/docker-compose.demo.yml --env-file deploy/.env.demo ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"'
if [[ "$MODE" == split ]]; then
  echo "==> API is up. Storefront and admin deploy from Vercel; values for their settings are in deploy/.vercel-env."
fi
