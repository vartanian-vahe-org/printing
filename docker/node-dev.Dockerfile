# Shared dev image for the Node apps (api, web, admin).
# Source code is bind-mounted at /app by docker-compose; node_modules live in named volumes.
FROM node:24.22.0-trixie-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store

RUN corepack enable && corepack prepare pnpm@10.34.7 --activate

WORKDIR /app
