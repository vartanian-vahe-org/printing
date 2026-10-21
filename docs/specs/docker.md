# Docker

Trạng thái: **Đã dựng** (Phase 1 bước 1). Hướng dẫn chạy: [README.md](../../README.md)
Cập nhật: 2026-10-19
Quyết định gốc: [decisions.md](../decisions.md) T12

## 1. Mục tiêu

- Clone repo, chạy **một lệnh** là có đủ môi trường dev: database, queue, các app, worker.
- Mỗi app build được thành **Docker image riêng** để deploy.
- Dev và production dùng cùng phiên bản Postgres, Redis, Node, Python.

## 2. Môi trường dev (Docker Compose)

File `docker-compose.yml` ở gốc repo.

| Service | Image / build | Port | Ghi chú |
|---|---|---|---|
| `postgres` | `postgres:18.6-trixie` | 5432 | Volume mount ở `/var/lib/postgresql` (cách mới từ Postgres 18) |
| `redis` | `redis:8.8.3-trixie` | 6379 | Queue BullMQ, bật AOF |
| `storage` | `rustfs/rustfs:1.0.3` | 9000 / 9001 | Giả lập S3 ở máy dev. Code gọi thẳng AWS SDK, chỉ đổi endpoint (`S3_ENDPOINT`, path-style). |
| `storage-init` | `amazon/aws-cli:2.38.1` | — | Tạo bucket upload và CORS rồi thoát |
| `mailpit` | `axllent/mailpit:v1.31.6` | 8025 / 1025 | Bắt email gửi ra ở môi trường dev, xem trên web |
| `deps` | `docker/node-dev.Dockerfile` | — | `pnpm install` vào các volume `node_modules` rồi thoát. Các app Node chờ service này xong. |
| `api` | `docker/node-dev.Dockerfile` | 4000 | NestJS, hot reload (`nest start --watch`) |
| `web` | `docker/node-dev.Dockerfile` | 3000 | Next.js storefront, hot reload |
| `admin` | `docker/node-dev.Dockerfile` | 5173 | React + Vite, hot reload |
| `worker-prepress` | `apps/worker-prepress` (target `dev`) | — | Python, tự reload bằng `watchfiles` |
| `migrate` | `docker/node-dev.Dockerfile` | — | Build `@printing/db`, chạy migration (schema + data seed) và tạo admin đầu tiên, rồi thoát. `api` chờ service này xong mới khởi động. |

**Vì sao RustFS thay vì MinIO:** image `minio/minio` đã bị gỡ khỏi Docker Hub (kiểm tra ngày 2026-10-19). RustFS là bản S3-compatible mã nguồn mở (Apache 2.0), dùng được với AWS SDK. Chỉ dùng ở dev; production dùng AWS S3 thật.

- Code được **mount vào container** để sửa là reload ngay, không phải build lại image.
- `node_modules` nằm trong volume của container, không dùng chung với máy host (tránh lỗi khác hệ điều hành).
- Stripe ở dev dùng **test mode** và Stripe CLI để chuyển tiếp webhook về `api`.

**Lệnh dự kiến:**

```bash
docker compose up             # chạy toàn bộ
docker compose run --rm migrate          # chạy lại migration
docker compose run --rm api pnpm db:seed:dev   # nạp dữ liệu giả cho dev
docker compose down -v        # xoá sạch, kể cả dữ liệu
```

## 3. Image để deploy

Mỗi app một `Dockerfile` **multi-stage**: stage build cài dependency và build, stage chạy chỉ chứa phần cần thiết.

| App | Image chạy | Ghi chú |
|---|---|---|
| `api` | Node (slim) | Build bằng `turbo prune` để image chỉ chứa package `api` cần |
| `web` | Node (slim) | Next.js `output: 'standalone'` |
| `admin` | Nginx | Build ra file tĩnh rồi serve bằng Nginx |
| `worker-prepress` | Python (slim) | Cài sẵn Ghostscript và profile màu ICC |

- Container chạy bằng **user không phải root**.
- Phiên bản base image **ghi cố định**, không dùng tag `latest`.
- Có `healthcheck` cho `api`, `web`, `postgres`, `redis`.
- Cấu hình truyền qua **biến môi trường**. Có file `.env.example` liệt kê đủ biến; file `.env` thật không commit.

## 4. Production

- Postgres và Redis ở production nên dùng **dịch vụ managed của AWS** (RDS, ElastiCache), file dùng **S3** thật. Không chạy database trong container ở production.
- Chạy các image app trên AWS (vd. ECS) hoặc VPS có Docker. Chốt khi tới bước deploy.
- Migration chạy như một bước riêng trước khi deploy phiên bản mới.

## 5. Còn mở

- [ ] Nơi chạy production: AWS ECS hay VPS
- [ ] Registry lưu image (AWS ECR, GitHub Container Registry...)
- [ ] CI/CD build và đẩy image
