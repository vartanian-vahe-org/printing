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
| Admin (React + Vite) | http://localhost:5173 (sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`) |
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
| POST | `/uploads/presign` | Presigned PUT URL (exact size and content type, 15 min); `kind`: `artwork` (PDF, default) or `logo` (PNG/JPG/WebP/SVG, 5 MB) |
| GET | `/cart` | Guest cart from the httpOnly `cart` cookie, re-priced with current prices |
| POST | `/cart/items` | Add an item (configuration + template or uploaded design); creates the cart and cookie on first valid add |
| PATCH · DELETE | `/cart/items/:id` | Change quantity (to a listed tier) · remove an item |
| PUT | `/cart/items/:id` | Replace an item's options and design (Edit in the cart), checked like a new add |
| POST | `/checkout/quote` | Shipping options, sales tax and totals for the cart (`address: {state, zip}`, `shippingMethodCode`) |
| POST | `/checkout/orders` | Place the order: email, US address, shipping method, `expectedTotalCents` (409 `total_changed` if prices moved) |
| GET | `/orders/:number` | Customer order view incl. progress and tracking; secret from the order link in the `X-Order-Token` header |
| POST | `/orders/lookup` | "Find my order": emails the order link if number + email match (always 202; 5 per order / 10 per IP per hour) |
| GET | `/admin/orders` | Order list: `view` (needs_payment, ready, printing, shipped, cancelled, all), `q` (#number, email, name), `page`; counts per view (admin) |
| GET | `/admin/orders/:number` | Order detail: items with file download links, payments, shipments, history, allowed actions (admin) |
| POST | `/admin/orders/:number/payments` · `/production` · `/shipments` · `/delivered` · `/cancel` · `/refunds` | Workflow actions; refused with 409 when the order is not in the right state; customer emails optional (admin) |
| POST | `/admin/orders/:number/notes` · `/emails` | Internal note · resend a customer email (admin) |
| GET | `/admin/orders/:number/items/:item/print-file` | Print-ready PDF of item `:item` (1-based): bleed-size pages, trim box, Inter/Lora embedded (admin, staff too) |
| POST | `/admin/orders/:number/items/:item/preflight` · `/proof/approve` | Run the file check again (staff too) · approve a proof for the customer (admin) |
| POST | `/orders/:number/items/:item/proof/approve` | Customer approves a proof; `acknowledged`: ids of every warning (`X-Order-Token`) |
| POST | `/orders/:number/items/:item/file` | Customer replaces an uploaded PDF; it is checked again (`X-Order-Token`) |
| GET · POST · PATCH | `/admin/staff` · `/admin/staff/:id` · `/admin/staff/:id/password` | Staff accounts (owner only) |
| POST | `/admin/auth/password` | Change your own password (signs out your other sessions) |
| GET · PUT | `/admin/settings` · `/settings/store` · `/settings/calendar` | Store name and emails, cutoff time, working days (owner, admin) |
| POST · DELETE | `/admin/settings/holidays` · `/holidays/:date` | Holidays (owner, admin) |
| GET | `/admin/audit` | Admin change history, `area` = catalog, settings, staff, auth (owner, admin) |
| POST | `/admin/auth/password/forgot` · `/password/reset` | Admin password reset by email (link 30 min, once) |
| POST | `/admin/auth/login/verify` · `/2fa/setup` · `/2fa/enable` · `/2fa/disable` | Two-step sign-in (authenticator app); `/admin/staff/:id/2fa/reset` for the owner |
| POST | `/admin/maintenance/cleanup` | Run the daily cleanup now (owner): old carts, unused uploads, expired sessions |
| PATCH · POST | `/account/profile` · `/account/password` | Customer name · password change (signed in) |
| GET | `/account/me` | Signed-in customer (or `null`) with last shipping address |
| POST | `/account/register` · `/sign-in` · `/sign-out` | Customer accounts (cookie `customer_session`); signing in brings the saved cart |
| POST | `/account/verify` · `/verify/resend` | Confirm the email (token from the email link); past orders with that email join the account |
| POST | `/account/password/forgot` · `/password/reset` | Password reset by email (always 202; link works once, 60 min) |
| GET · POST | `/account/orders` · `/account/orders/:number/reorder` | Order history with private order links · put a past order back in the cart |
| POST | `/admin/auth/login` · `/logout` · GET `/me` | Admin session (httpOnly cookie, 5 failed attempts / 15 min limit) |
| GET | `/admin/products/:code/catalog` | Full configuration incl. hidden values (admin) |
| PATCH | `/admin/products/:code/groups/:group/values/:value` | Edit label, description, order, active, default, attributes (admin) |
| PUT | `/admin/products/:code/rules` | Set or remove a rule (admin) |
| PUT | `/admin/products/:code/pricing` | Base prices, tier visibility/default, upcharges (admin) |
| PATCH | `/admin/products/:code/templates/:template` | Show or hide a template (admin) |

Admin writes run in a transaction and are rejected if the storefront could no longer build and price a default configuration.

Prepress worker tests (Python):

```bash
docker compose run --rm --no-deps worker-prepress python -m pytest -q tests
```

API tests (stack must be running):

```bash
cd apps/api
DATABASE_URL=postgres://printing:printing@localhost:5432/printing corepack pnpm test:integration
set -a; . ../../.env; set +a; corepack pnpm test:e2e      # admin tests need ADMIN_EMAIL / ADMIN_PASSWORD
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
| `0007_staff_sessions` | Admin login sessions |
| `0008_commerce` | Carts, orders, order items, payments, shipments, tax rates |
| `0009_seed_tax_rates` | California placeholder tax rate (state base 7.25%, see open issue S7) |
| `0010_store_settings` | Store settings table (name, support email, new-order notification emails) |
| `0011_seed_store_settings` | Placeholder store name and `.local` addresses (open issues U1, S15) |
| `0012_order_events` | Order history (placed, payments, status changes, emails sent, notes) |
| `0013_payment_cancelled_status` | Payment status `cancelled` (pending payment of a cancelled order) |
| `0014_order_dates` | Estimated ship-by date and delivery window on orders |
| `0015_order_item_print_spec` | Print spec frozen on order items (size, back mode, template layout) |
| `0016_proofs` | File check results, proof status `needs_new_file`, proof approval time and approver |
| `0017_audit_log` | Admin change history (catalog, prices, staff, settings) |
| `0018_customers` | Customer accounts, sign-in sessions, one-time email links |
| `0019_customer_indexes` | Indexes on the customer of carts and orders |
| `0020_staff_password_resets` | One-time admin password reset links |
| `0021_staff_totp` | Admin two-step sign-in secret (encrypted) |

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

## Troubleshooting

- **The API takes up to a minute to restart**: background workers (emails, file checks, cleanup) finish their current Redis call before stopping. Wait for `Nest application successfully started` in `docker compose logs api`.
- **The API does not pick up a code change** (the file watcher in Docker occasionally misses an edit): `docker compose restart api`.
- **e2e tests talk to the wrong Redis / Postgres**: another server on the host may already listen on the same port (e.g. a Homebrew `redis-server` on 6379 takes `localhost` before Docker). Stop it, or change `REDIS_PORT` / `POSTGRES_PORT` in `.env`.

- **The page keeps reloading by itself** (usually right after adding a dependency): clear the Next.js cache and restart web:
  `docker compose exec web sh -c 'rm -rf /app/apps/web/.next/*' && docker compose restart web`
- **A new workspace package is not found in a container**: add a `node_modules` volume for it in `docker-compose.yml` (see the existing `*_node_modules` volumes), then `docker compose run --rm deps`.

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
  api-proxy/         Same-origin /api proxy used by web and admin on Vercel (plain JS)
  tsconfig/          Shared TypeScript config
docker/              Dev Dockerfile and init scripts
deploy/              Demo deployment: all on EC2 (deploy/README.md) or sites on Vercel + API on EC2 (deploy/VERCEL.md)
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
