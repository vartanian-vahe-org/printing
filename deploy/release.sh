#!/usr/bin/env bash
# Deploys everything from this machine, then pushes to GitHub:
#   1. checks that the work is committed (what is deployed is exactly what gets pushed)
#   2. typecheck and unit tests, locally
#   3. API, worker and migrations on EC2 (deploy.sh)
#   4. storefront and admin on Vercel with the Vercel CLI (code uploaded from here, built by Vercel)
#   5. git push
# Pushing does not deploy by itself: both vercel.json files turn Git deployments off.
#
# Usage:  DEPLOY_HOST=<ip> DEPLOY_KEY=<path-to-pem> deploy/release.sh [--skip-api] [--skip-push]
#   --skip-api   only the storefront and admin changed (nothing in apps/api, worker, packages/*)
#   --skip-push  deploy without pushing (e.g. trying something on staging)
# One-time setup: npx vercel@64.7.0 login (an account in the Alex Organization team).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERCEL=(npx --yes vercel@64.7.0)
# The Vercel team and projects (IDs are not secret). Deploying from the repo root with these lets each
# project apply its own Root Directory (apps/web, apps/admin); `vercel link --repo` cannot be used
# because it does not understand the SSH alias in the Git remote.
VERCEL_TEAM_ID="${VERCEL_TEAM_ID:-team_BVUbv0fTJ81aC3ybfxnJ6KiU}"
VERCEL_WEB_PROJECT_ID="${VERCEL_WEB_PROJECT_ID:-prj_juqDvLnfJid3UbGGVIA0zQuV3t7y}"
VERCEL_ADMIN_PROJECT_ID="${VERCEL_ADMIN_PROJECT_ID:-prj_jLHPkM3EVlNyWo3Wem94t5k9pZlg}"
SKIP_API=false
SKIP_PUSH=false
for arg in "$@"; do
  case "$arg" in
    --skip-api) SKIP_API=true ;;
    --skip-push) SKIP_PUSH=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
cd "$ROOT"

echo "==> Checking the working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit (or stash) your changes first, so the deployed code is what gets pushed:" >&2
  git status --short >&2
  exit 1
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == main ]] || { echo "Releases go out from main (you are on $BRANCH)." >&2; exit 1; }
"${VERCEL[@]}" whoami >/dev/null 2>&1 || { echo "Not signed in to Vercel. Run once: ${VERCEL[*]} login" >&2; exit 1; }

echo "==> Typecheck and unit tests"
# Turbo looks for a `pnpm` binary; without a global one, a temporary corepack shim provides it.
if ! command -v pnpm >/dev/null; then
  SHIM="$(mktemp -d)"
  corepack enable --install-directory "$SHIM" pnpm
  PATH="$SHIM:$PATH"
fi
pnpm turbo run typecheck test

if [[ "$SKIP_API" == false ]]; then
  echo "==> API on EC2"
  "$ROOT/deploy/deploy.sh"
fi

for app in web admin; do
  echo "==> $app on Vercel (production)"
  project_var="VERCEL_$(echo "$app" | tr '[:lower:]' '[:upper:]')_PROJECT_ID"
  VERCEL_ORG_ID="$VERCEL_TEAM_ID" VERCEL_PROJECT_ID="${!project_var}" "${VERCEL[@]}" deploy --prod --yes
done

if [[ "$SKIP_PUSH" == false ]]; then
  echo "==> Pushing $BRANCH"
  git push origin "$BRANCH"
fi
echo "==> Done"
