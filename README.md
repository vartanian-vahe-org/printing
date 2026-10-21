# Printing

Online business card printing for the US market. Monorepo: pnpm + Turborepo, everything runs in Docker.

Docs (decisions, research, specs, plan): [docs/README.md](docs/README.md)

## Quick start

Requirements: Docker Desktop.

```bash
cp .env.example .env
docker compose up
```

The first run installs dependencies inside the containers and takes a few minutes.

| Service | URL |
|---|---|
| Storefront (Next.js) | http://localhost:3000 |
| Admin (React + Vite) | http://localhost:5173 |
| API (NestJS) | http://localhost:4000/health |
| Mailpit (dev email inbox) | http://localhost:8025 |
| Storage (RustFS, S3-compatible) | API http://localhost:9000, console http://localhost:9001 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |

Code is bind-mounted, so the apps reload on save.

On startup the `migrate` service applies all database migrations (schema + default catalog data) and creates the first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. It never overwrites data that already exists.

## API (Phase 1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Database, Redis, storage status |
| GET | `/products/:code/configurator` | Catalog (options, rules, tiers, upcharges) + default selection |
| GET | `/products/:code/templates` | Active templates with validated layouts |
| POST | `/quotes` | Official price; 400 with `issues` if the configuration is invalid |
| POST | `/uploads/presign` | Presigned PUT URL for a PDF (exact size and content type, 15 min) |

API tests (stack must be running):

```bash
cd apps/api
DATABASE_URL=postgres://printing:printing@localhost:5432/printing corepack pnpm test:integration
corepack pnpm test:e2e
```

## Database

Schema lives in `packages/db/src/schema/`, migrations in `packages/db/migrations/` (Drizzle).

| Migration | Content |
|---|---|
| `0000_init_schema` | All tables |
| `0001_seed_business_cards_catalog` | Business card product, option groups and values |
| `0002_seed_business_cards_rules` | Option rules R1–R7 |
| `0003_seed_business_cards_pricing` | Quantity tiers, base prices, upcharges (placeholder prices) |
| `0004_seed_production_settings` | 2 PM Pacific cutoff, Mon–Fri, US holidays 2026–2027 |
| `0005_seed_shipping_methods` | Sample shipping methods |
| `0006_seed_business_card_templates` | 5 card templates (source: `packages/templates/seed/`) |

```bash
docker compose run --rm migrate      # apply pending migrations
docker compose exec postgres psql -U printing -d printing   # SQL shell
```

Changing the schema (from the host):

```bash
cd packages/db
corepack pnpm build && corepack pnpm generate --name <change_name>                  # schema migration
corepack pnpm build && corepack pnpm generate:custom --name <seed_name>             # empty data migration to fill in
```

Rules for data migrations: reference rows by `code`, insert with `ON CONFLICT DO NOTHING`, and never edit a migration that has already run in a shared environment — add a new one.

## Common commands

```bash
docker compose up -d                 # start in background
docker compose logs -f api           # follow logs of one service
docker compose run --rm deps         # reinstall dependencies after changing package.json
docker compose restart api           # restart one service
docker compose down                  # stop
docker compose down -v               # stop and delete all data volumes
```

Adding a dependency (from the host, then reinstall in the containers):

```bash
corepack pnpm --filter @printing/api add <package>
docker compose run --rm deps && docker compose restart api
```

## Tests

```bash
docker compose run --rm --no-deps api pnpm turbo run test typecheck   # all packages, inside Docker
corepack pnpm --filter @printing/pricing test                          # one package, on the host
```

## Repository layout

```
apps/
  api/               NestJS + Express API
  web/               Next.js storefront
  admin/             React + Vite admin SPA
  worker-prepress/   Python prepress worker
packages/
  db/                Drizzle schema, migrations, migrate + admin seed scripts
  pricing/           Option rules, custom size and price calculation (shared by web and api)
  templates/         Template layout format + JSON -> SVG renderer (shared by web and api)
  tsconfig/          Shared TypeScript config
docker/              Dev Dockerfile and init scripts
deploy/              Demo deployment (EC2 + Caddy), see deploy/README.md
docs/                Decisions, research, specs, plans
```

## Production images

Each app has a multi-stage `Dockerfile` (non-root user, pinned base images). Build from the repo root:

```bash
docker build -f apps/api/Dockerfile -t printing-api .
docker build -f apps/web/Dockerfile -t printing-web .
docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t printing-admin .
docker build --target prod -t printing-worker apps/worker-prepress
```
