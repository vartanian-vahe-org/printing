# Production image for the admin SPA. Build from the repo root:
#   docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t printing-admin .
FROM node:24.22.0-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@2.11.9
COPY . .
RUN turbo prune @printing/admin --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm turbo run build --filter=@printing/admin

FROM nginxinc/nginx-unprivileged:1.30-alpine AS runner
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
