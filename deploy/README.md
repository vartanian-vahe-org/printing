# Demo deployment (AWS EC2)

Single server running the production images with Docker Compose. Caddy terminates HTTPS
(Let's Encrypt) and protects the site with a password. Hostname comes from sslip.io
(`1.2.3.4` → `1-2-3-4.sslip.io`) until a real domain is chosen (docs/open-issues.md I1).

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
deploy/make-env.sh <elastic-ip> <your-email>      # writes deploy/.env.demo + deploy/.demo-credentials
scp -i ~/.ssh/printing-demo.pem deploy/server-setup.sh ubuntu@<elastic-ip>:~
ssh -i ~/.ssh/printing-demo.pem ubuntu@<elastic-ip> 'bash server-setup.sh'
```

## 3. Deploy (first time and every update)

```bash
DEPLOY_HOST=<elastic-ip> DEPLOY_KEY=~/.ssh/printing-demo.pem deploy/deploy.sh
```

The first build takes several minutes. Then open `https://<ip-with-dashes>.sslip.io`; the
username and password are in `deploy/.demo-credentials` (git-ignored, share it privately).

## What runs

| Service | Notes |
|---|---|
| caddy | Only public service (80/443). HTTPS, basic auth, `noindex` header |
| web | Next.js storefront (production image) |
| api | NestJS API (production image), internal only |
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
