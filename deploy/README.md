# Demo deployment (AWS EC2)

Single server running the production images with Docker Compose. Caddy terminates HTTPS
(Let's Encrypt) and protects the site with a password. Hostname comes from sslip.io
(`1.2.3.4` → `1-2-3-4.sslip.io`) until a real domain is chosen (docs/open-issues.md I1).

Two layouts, chosen when `.env.demo` is generated:

| Layout | Storefront and admin | Server runs | Guide |
|---|---|---|---|
| **All-in-one** | Containers on the server | Everything | This page |
| **Split** | Two Vercel projects (`apps/web`, `apps/admin`) | API, worker, database, storage, mail | [VERCEL.md](VERCEL.md), then steps 1–3 here |

## 1. Create the server (AWS console)

| Setting | Value |
|---|---|
| Region | `us-west-1` (N. California) |
| AMI | Ubuntu Server 24.04 LTS, **64-bit (Arm)** |
| Instance type | `t4g.medium` (2 vCPU, 4 GB) |
| Key pair | New, ED25519, `.pem`. Save it, e.g. `~/.ssh/printing-demo.pem`, then `chmod 400` it |
| Storage | 30 GB gp3 |
| Security group | SSH 22 from **My IP**; HTTP 80 and HTTPS 443 from anywhere |
| Elastic IP | Allocate one and associate it with the instance (keeps the IP and hostname stable) |

## 2. Prepare (from this repo, on your machine)

```bash
deploy/make-env.sh <elastic-ip> <your-email>      # all-in-one: writes deploy/.env.demo + deploy/.demo-credentials
# split: deploy/make-env.sh <elastic-ip> <your-email> <storefront-url> <admin-url>   (see VERCEL.md)
scp -i ~/.ssh/printing-demo.pem deploy/server-setup.sh ubuntu@<elastic-ip>:~
ssh -i ~/.ssh/printing-demo.pem ubuntu@<elastic-ip> 'bash server-setup.sh'
```

## 3. Deploy (first time and every update)

```bash
DEPLOY_HOST=<elastic-ip> DEPLOY_KEY=~/.ssh/printing-demo.pem deploy/deploy.sh
```

The first build takes several minutes. Then open `https://<ip-with-dashes>.sslip.io`; the
username and password are in `deploy/.demo-credentials` (git-ignored, share it privately).
In the split layout the storefront and admin are the Vercel URLs instead, and the server only
answers on `api.`, `files.` and `mail.`.

| Address | What |
|---|---|
| `https://<ip-with-dashes>.sslip.io` | Storefront (demo password) |
| `https://admin.<ip-with-dashes>.sslip.io` | Admin (demo password, then the admin sign-in from `.demo-credentials`) |
| `https://mail.<ip-with-dashes>.sslip.io` | Emails the demo sent (Mailpit, demo password) |
| `https://api.<ip-with-dashes>.sslip.io` | API, called by the browser (no demo password; orders need their private link) |
| `https://files.<ip-with-dashes>.sslip.io` | File storage for presigned uploads and downloads |

## What runs

| Service | Notes |
|---|---|
| caddy | Only public service (80/443). HTTPS for every subdomain, basic auth on the site, admin and mail, `noindex` header. Split layout: `Caddyfile.backend` (api, files, mail only) |
| web | All-in-one only. Next.js storefront (production image), built with `NEXT_PUBLIC_API_URL=https://api.<domain>` |
| admin | All-in-one only. Admin SPA (nginx), built with `VITE_API_URL=https://api.<domain>` |
| api | NestJS API (production image), `COOKIE_SECURE=true`, CORS for the site and admin |
| worker-prepress | File checks and proof images (Python) |
| mailpit | Catches all outgoing email (no real email is sent from the demo) |
| migrate | Runs migrations + first admin from the API image, then exits |
| postgres, redis, storage (RustFS) | In containers for the demo only (I3: production uses RDS / ElastiCache / S3) |

## Useful commands (on the server)

```bash
cd ~/printing
C="sudo docker compose -f deploy/docker-compose.demo.yml --env-file deploy/.env.demo"
$C ps
$C logs -f web
$C restart api
$C down            # stop (data volumes are kept)
```
