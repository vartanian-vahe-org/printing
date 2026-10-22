# Split deployment: storefront and admin on Vercel, API on EC2

Two Vercel projects from this one repo (`apps/web` and `apps/admin`), and the EC2 server from
[README.md](README.md) running only the backend: API, prepress worker, Postgres, Redis, file
storage and Mailpit, behind Caddy.

```
browser ──► printing-web.vercel.app ──/api/*──┐
browser ──► printing-admin.vercel.app ─/api/*─┼──► https://api.<ip>.sslip.io  (EC2)
browser ──► https://files.<ip>.sslip.io ◄─────┘    uploads and downloads (presigned)
```

## How the sites reach the API

Each Vercel site answers `/api/*` itself and forwards the call to the API (`@printing/api-proxy`):
the storefront with a Next.js route (`apps/web/app/api/[...path]/route.ts`), the admin with a Vercel
function (`apps/admin/api/proxy.js`). Why:

- **Cookies stay first-party.** The cart, customer and admin session cookies belong to the site's own
  domain. Browsers block cookies from another domain (`api.<ip>.sslip.io`) more and more, and Safari
  already does.
- **No CORS for API calls.** The browser only talks to its own site. Only file uploads go straight
  to `files.<ip>.sslip.io` (presigned), so the storage CORS list needs the site URLs.
- **Rate limits per visitor.** The proxy passes the visitor IP in `x-client-ip` together with
  `x-proxy-secret`; the API only believes that IP when the secret matches (`API_PROXY_SECRET`, the
  same value on EC2 and in both Vercel projects). Pages rendered by Next.js send the secret without
  an IP and skip the public read limit.

## Steps

The Vercel URLs go into the server settings (CORS, links in emails), and the API address goes into
Vercel, so the order matters.

### 1. Server

Do step 1 of [README.md](README.md) (EC2 instance and Elastic IP).

### 2. Create the two Vercel projects

The code has to be in a Git repository on GitHub, GitLab or Bitbucket. In Vercel: **Add New →
Project → Import** the repository, twice:

| Setting | Storefront | Admin |
|---|---|---|
| Project name | e.g. `printing-web` → `https://printing-web.vercel.app` | e.g. `printing-admin` → `https://printing-admin.vercel.app` |
| Root Directory | `apps/web` | `apps/admin` |
| Framework, build, install, output | from `apps/web/vercel.json` (leave the defaults) | from `apps/admin/vercel.json` (leave the defaults) |

After importing, in each project's **Settings → Build and Deployment**:

- Node.js Version: **24.x**
- "Include files outside the root directory in the Build Step": **on** (the default; the apps use
  `packages/*`)

The first deployment may fail or show "We can't load the product" because there are no environment
variables yet. That is expected. Write down the **production** URL of each project (Settings →
Domains).

### 3. Server settings with the Vercel URLs

```bash
deploy/make-env.sh <elastic-ip> <your-email> https://printing-web.vercel.app https://printing-admin.vercel.app
```

This writes three git-ignored files:

| File | What |
|---|---|
| `deploy/.env.demo` | Server settings, layout `split` (no web/admin containers, Caddy serves `api.`, `files.`, `mail.` only) |
| `deploy/.demo-credentials` | Demo password, admin sign-in |
| `deploy/.vercel-env` | The environment variables for the two Vercel projects, secrets included |

### 4. Start the backend

Steps 2 and 3 of [README.md](README.md) (`server-setup.sh`, then `deploy.sh`). Check:

```bash
curl https://api.<ip-with-dashes>.sslip.io/health
```

### 5. Environment variables in Vercel

Copy the values from `deploy/.vercel-env` into each project: **Settings → Environment Variables**,
environment **Production** (also Preview if you use previews, see below).

Storefront (`apps/web`):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api` | Browser calls go through the site. Baked in at build time |
| `API_ORIGIN` | `https://api.<ip-with-dashes>.sslip.io` | Where `/api` forwards to |
| `API_INTERNAL_URL` | `https://api.<ip-with-dashes>.sslip.io` | Used by pages rendered on the server |
| `API_PROXY_SECRET` | from `.vercel-env` | Secret. Same value as on the server |
| `SITE_BASIC_AUTH` | `demo:<password>` | Optional. Password-protects the whole storefront (the demo password) |
| `SITE_NOINDEX` | `true` | Optional. Tells search engines not to index the demo |

Admin (`apps/admin`):

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_URL` | `/api` | Baked in at build time |
| `VITE_STOREFRONT_URL` | `https://printing-web.vercel.app/business-cards` | "Open storefront" link. Baked in at build time |
| `API_ORIGIN` | `https://api.<ip-with-dashes>.sslip.io` | |
| `API_PROXY_SECRET` | from `.vercel-env` | Secret |

Then **Deployments → ⋯ → Redeploy** in both projects (the `VITE_*` and `NEXT_PUBLIC_*` values only
take effect in a new build).

### 6. Check

1. Storefront: the browser asks for the demo username and password (`.demo-credentials`), then the
   configurator shows prices.
2. Add a card to the cart, reload: the cart is kept (cookie on the Vercel domain).
3. Upload a PDF in the configurator: it works only if the storefront URL is in `SITE_URLS` (storage CORS).
4. Admin: sign in with the admin account from `.demo-credentials`.
5. Emails sent by the demo: `https://mail.<ip-with-dashes>.sslip.io`. Order links point to the storefront URL.

## Day to day

| Change | What to do |
|---|---|
| Code in `apps/web` or `apps/admin` | Push. Vercel builds each project. Both projects build on every push unless you set "Ignored Build Step" (e.g. `npx turbo-ignore`) |
| Code in `apps/api`, `apps/worker-prepress`, `packages/db` (migrations) | `deploy/deploy.sh` (EC2) |
| Code in `packages/pricing` or `packages/templates` | Both: push for Vercel **and** `deploy.sh` for the API, so prices and print files match the storefront |
| A Vercel environment variable | Redeploy that project |
| `API_PROXY_SECRET` | Change it in `.env.demo` and both Vercel projects, then `deploy.sh` and redeploy both |

## Good to know

- **Production URLs only.** `WEB_URL`, `ADMIN_URL` and `SITE_URLS` on the server list the production
  URLs. Preview deployments (`printing-web-git-branch-….vercel.app`) work for browsing, the cart and
  checkout (everything goes through `/api`), but file uploads fail (storage CORS). Emails always link
  to the production URL. To allow a preview, add its URL to `SITE_URLS` in `.env.demo` and run
  `deploy.sh`.
- **The admin has no demo password on Vercel**, only its own sign-in (turn on two-step sign-in under
  Account). Vercel's Deployment Protection can add one on paid plans.
- **The API is public** at `api.<ip>.sslip.io` (the sites need it). Direct callers get the normal
  per-IP rate limits. Only the Vercel proxies know `API_PROXY_SECRET`. Never put it in a `NEXT_PUBLIC_*`
  or `VITE_*` variable.
- **Region.** Both `vercel.json` files run functions in `sfo1` (San Francisco), close to EC2 `us-west-1`.
  Every page load and API call makes one extra hop from Vercel to EC2.
- **Upload size.** Uploads go straight to storage, not through Vercel, so Vercel's 4.5 MB request
  limit does not apply to PDFs. API calls through `/api` are small JSON.
- **Custom domain later** (open issue I1): add the domain in Vercel, put the new URLs in `WEB_URL`,
  `ADMIN_URL` and `SITE_URLS`, update `VITE_STOREFRONT_URL`, then `deploy.sh` and redeploy the admin.

## Moving an existing all-in-one server to split

Do **not** delete `.env.demo` and run `make-env.sh` again: the new database password would not
match the existing database. Edit `deploy/.env.demo` instead:

```bash
# remove these two lines
COMPOSE_PROFILES=sites
CADDYFILE=Caddyfile
# add these
DEPLOY_MODE=split
CADDYFILE=Caddyfile.backend
WEB_URL=https://printing-web.vercel.app
ADMIN_URL=https://printing-admin.vercel.app
SITE_URLS=https://printing-web.vercel.app,https://printing-admin.vercel.app
API_PROXY_SECRET=<output of: openssl rand -hex 32>
```

Then run `deploy.sh`. It removes the web and admin containers (`--remove-orphans`). Then do step 5
above with the same `API_PROXY_SECRET`. The demo password for `SITE_BASIC_AUTH` is in
`.demo-credentials`.
