# Production image for the API. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t printing-api .
FROM node:24.22.0-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@2.11.9
COPY . .
RUN turbo prune @printing/api --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@printing/api
RUN pnpm --filter @printing/api deploy --legacy --prod /prod/api

FROM node:24.22.0-trixie-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /prod/api .
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
