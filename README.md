# ShopFast

Backend sàn thương mại điện tử cho ~200.000 khách hàng — Defense Case Study 6 (Module 6).
NestJS 10 · Node.js 20 · PostgreSQL 16 · Redis 7 · Docker Compose · GitHub Actions · AWS EC2.

- Đề bài: [srs.md](srs.md)
- Kiến trúc, module, kế hoạch: [docs/](docs/README.md)
- Dựng hạ tầng AWS: [infra/aws/README.md](infra/aws/README.md)

## Chạy cục bộ

Yêu cầu: Node.js ≥ 20, Docker Desktop, pnpm 9 (`corepack enable` — hoặc gọi `corepack pnpm@9.15.4 …`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm infra:up          # PostgreSQL :5432, Redis :6379, Mailpit http://localhost:8025
pnpm db:migrate
pnpm dev:api           # http://localhost:3000/api/health/ready · Swagger http://localhost:3000/api/docs
pnpm dev:worker        # tiến trình nền
pnpm dev:web           # http://localhost:5173
```

## Lệnh thường dùng

| Lệnh | Việc |
|------|------|
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Chất lượng mã |
| `pnpm test` / `pnpm test:cov` | Unit test (ngưỡng coverage 60% tầng nghiệp vụ) |
| `pnpm test:int` | Integration test — cần `pnpm infra:up` |
| `pnpm --filter api migration:generate src/infra/database/migrations/<Name>` | Sinh migration từ entity |

## Cấu trúc

```
apps/api     NestJS — 2 entrypoint: src/main.ts (api) và src/worker.ts (worker)
apps/web     React + Vite — giao diện tối thiểu để demo
infra/       Dockerfile, Compose, Nginx, script triển khai/sao lưu, IAM policy
.github/     CI (lint, test, coverage, gitleaks, docker build) và Deploy (GHCR → runner trên EC2 → blue/green → smoke → rollback)
docs/        Tài liệu kiến trúc & quyết định kỹ thuật
```

## Luồng triển khai

PR → CI xanh → merge `main` → build image `:<sha>` → GHCR (token tạm của job) → self-hosted runner trên EC2 chạy `deploy.sh <sha>` (không có access key AWS nào)
→ migration → bật màu rảnh (blue/green) → health check → chuyển Nginx → smoke test qua HTTPS → hỏng thì `rollback.sh`.
Chi tiết: [docs/05-deployment-cicd.md](docs/05-deployment-cicd.md).
