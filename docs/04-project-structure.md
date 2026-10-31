# 04 — Cấu trúc mã nguồn & quy ước

## 1. Monorepo

```
shopfast/
├── apps/
│   ├── api/                      # NestJS 10 — build ra 2 entrypoint: api + worker
│   └── web/                      # React + Vite — build ra file tĩnh
├── packages/
│   └── contracts/                # Kiểu dùng chung web ↔ api: enum trạng thái đơn, payload sự kiện socket
├── infra/
│   ├── docker/
│   │   ├── api.Dockerfile        # multi-stage: deps → build → runtime (node:20-alpine, user non-root)
│   │   └── web.Dockerfile        # build Vite → file tĩnh (deploy.sh chép ra, Nginx phục vụ)
│   ├── nginx/
│   │   ├── nginx.conf
│   │   ├── shopfast.conf.template  # server 80 (redirect) + 443 (TLS, /api, /socket.io, web tĩnh)
│   │   └── security-headers.inc    # header bảo mật, include lại trong từng location
│   ├── postgres/init/            # tạo user ứng dụng (owner DB, không phải superuser) khi volume trống
│   ├── compose/
│   │   ├── docker-compose.yml        # local: pg, redis, mailpit (+ profile app: api, worker)
│   │   └── docker-compose.prod.yml   # prod: nginx, api-blue, api-green, worker, pg, redis
│   ├── scripts/
│   │   ├── lib.sh                # hàm dùng chung + mô tả bố cục /opt/shopfast
│   │   ├── deploy.sh             # blue/green + health check + chuyển upstream
│   │   ├── rollback.sh           # quay về màu trước, hoặc deploy lại SHA trước
│   │   ├── render-env.sh         # SSM Parameter Store → shared/.env + shared/datastore.env (600)
│   │   ├── backup.sh             # pg_dump + số dòng từng bảng → S3
│   │   ├── restore.sh            # diễn tập: khôi phục vào container tạm, đối chiếu số dòng
│   │   ├── bootstrap-ec2.sh      # chuẩn bị EC2 mới (Docker, cron, swap, thư mục)
│   │   └── init-letsencrypt.sh, renew-cert.sh
│   └── aws/
│       ├── iam/                  # JSON policy của instance role shopfast-ec2
│       └── README.md             # các bước dựng hạ tầng (hoặc Terraform nếu còn thời gian)
├── tests/
│   └── load/                     # k6: catalog.js, place-order.js, login-bruteforce.js
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                # pull_request: lint, typecheck, unit, integration, coverage, gitleaks
│   │   └── deploy.yml            # sau CI xanh: build → GHCR → deploy (runner EC2) → smoke → rollback
│   └── pull_request_template.md
├── docs/                         # tài liệu này + runbooks/ + adr/
├── apps/api/.env.example         # biến môi trường cục bộ, KHÔNG có secret thật
├── pnpm-workspace.yaml
└── README.md                     # cài đặt & chạy cục bộ
```

## 2. `apps/api`

```
apps/api/
├── src/
│   ├── main.ts                   # bootstrap HTTP + WS, Swagger, trust proxy, graceful shutdown
│   ├── worker.ts                 # bootstrap WorkerModule (không mở cổng HTTP, trừ /health nội bộ)
│   ├── app.module.ts             # module cho tiến trình api
│   ├── worker.module.ts          # module cho tiến trình worker (processors, outbox relay, schedulers)
│   │
│   ├── infra/
│   │   ├── config/               # env.schema.ts, config.module.ts, typed config (app, db, redis, jwt, llm, aws)
│   │   ├── database/
│   │   │   ├── data-source.ts
│   │   │   ├── migrations/
│   │   │   ├── seeds/
│   │   │   └── transaction.ts    # runInTransaction(fn) helper
│   │   ├── redis/                # redis.module.ts, redis.health.ts
│   │   ├── cache/
│   │   │   ├── cache.service.ts          # getOrLoad / invalidate / bumpVersion
│   │   │   ├── distributed-lock.ts
│   │   │   ├── singleflight.ts
│   │   │   ├── circuit-breaker.ts
│   │   │   └── cache.service.spec.ts
│   │   ├── queue/
│   │   │   ├── queue.constants.ts        # QueueName, JobName, job options mỗi loại
│   │   │   ├── queue.module.ts
│   │   │   └── dead-letter.listener.ts   # failed && attemptsMade >= attempts → failed_jobs
│   │   ├── outbox/               # outbox.entity.ts, outbox.service.ts, outbox.relay.ts, event-to-job.map.ts
│   │   ├── llm/                  # llm.port.ts, anthropic.adapter.ts, fake.adapter.ts
│   │   ├── mail/                 # mail.port.ts, ses.adapter.ts, smtp.adapter.ts, templates/
│   │   ├── storage/              # storage.port.ts, s3.adapter.ts, local.adapter.ts
│   │   └── realtime-emitter/     # redis-emitter cho worker
│   │
│   ├── common/
│   │   ├── decorators/           # current-user, public, roles, rate-limit
│   │   ├── guards/               # jwt-auth.guard, roles.guard
│   │   ├── filters/              # all-exceptions.filter, messages.vi.ts (thông điệp lỗi tiếng Việt)
│   │   ├── interceptors/         # request-id, timing
│   │   ├── dto/                  # pagination
│   │   └── rate-limit/           # rate-limit.module, user-or-ip.guard, login-attempt.service, throttler.filter
│   │
│   └── modules/
│       ├── auth/
│       ├── users/
│       ├── catalog/
│       ├── inventory/
│       ├── cart/
│       ├── orders/
│       ├── payments/
│       ├── tracking/
│       ├── notifications/
│       ├── invoices/
│       ├── partner-sync/
│       ├── reports/
│       ├── support/
│       ├── ai-assistant/
│       ├── health/
│       └── admin/
├── test/
│   ├── integration/              # chạy với Postgres + Redis thật (Testcontainers / service container CI)
│   ├── e2e/                      # supertest + socket.io-client qua app đầy đủ
│   ├── ai-eval/                  # cases.json + runner (gọi LLM thật, chạy thủ công/nightly)
│   └── utils/                    # factories, test-app.ts, db reset
├── jest.config.ts                # unit — coverage threshold
└── jest.integration.config.ts
```

### Bố cục bên trong một module (ví dụ `orders`)

```
modules/orders/
├── orders.module.ts
├── controllers/
│   ├── orders.controller.ts          # khách
│   └── warehouse-orders.controller.ts# kho
├── orders.service.ts                 # placeOrder, cancel, changeStatus, listMine
├── orders.service.spec.ts            # unit — repo & port giả
├── order-state-machine.ts            # bảng chuyển trạng thái hợp lệ (hàm thuần, dễ test)
├── order-state-machine.spec.ts
├── repositories/
│   └── orders.repository.ts          # truy vấn TypeORM; không có nghiệp vụ
├── entities/
│   ├── order.entity.ts
│   ├── order-item.entity.ts
│   └── order-status-history.entity.ts
├── dto/
│   ├── place-order.dto.ts            # class-validator + @ApiProperty
│   ├── change-status.dto.ts
│   └── order.response.ts             # không trả entity thẳng ra ngoài
├── events/
│   └── order.events.ts               # tên + payload sự kiện (dùng chung outbox & realtime)
└── errors/
    └── order.errors.ts               # OutOfStockError, InvalidTransitionError …
```

Module có processor (chạy trong worker) đặt thêm `processors/<queue>.processor.ts`. Module chỉ đăng ký processor trong `WorkerModule`, không trong `AppModule`.

## 3. `apps/web`

```
apps/web/src/
├── main.tsx, App.tsx, router.tsx     # route theo vai trò, RequireRole
├── lib/
│   ├── api-client.ts                 # fetch wrapper: token, refresh, chuẩn hoá lỗi, xử lý 429
│   ├── socket.ts                     # 1 kết nối Socket.IO dùng chung
│   └── format.ts                     # tiền VND, ngày giờ
├── hooks/
│   ├── use-auth.ts
│   └── use-order-tracking.ts         # subscribe, re-subscribe khi connect, refetch bù
├── components/
│   ├── ui/                           # shadcn/ui: button, input, card, badge, skeleton, dialog, toast
│   └── shared/                       # EmptyState, ErrorState, PageHeader, OrderStatusBadge, Pagination
├── features/
│   ├── catalog/  cart/  checkout/  orders/  tracking/  tickets/
│   ├── support-console/              # ticket inbox + assistant panel + pending actions
│   ├── warehouse/
│   └── admin/                        # health, queues, failed jobs, cache stats
└── styles/
    └── globals.css                   # biến CSS token — khai báo màu/bo góc/bóng ở MỘT chỗ
```

## 4. Quy ước

**Đặt tên**
- File `kebab-case.ts`; class `PascalCase`; hằng số `UPPER_SNAKE_CASE`.
- Hậu tố theo vai trò: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.processor.ts`, `*.gateway.ts`, `*.dto.ts`, `*.entity.ts`, `*.port.ts`, `*.adapter.ts`.
- Khoá Redis: `<miền>:<thực thể>:<id>` — `product:123`, `catalog:list:v7:ab12`, `login:fail:a@b.com`, `lock:product:123`.
- Queue: `email`, `invoice`, `inventory-sync`, `payment-reminder`, `report`, `ai-classify`. `jobId`: `<loại>:<id nghiệp vụ>`.

**Code**
- TypeScript `strict: true`; cấm `any` (ESLint `no-explicit-any: error`).
- Service ném **lỗi miền** (`OutOfStockError`), `AllExceptionsFilter` ánh xạ sang HTTP + thông điệp tiếng Việt. Không ném `HttpException` trong service.
- Không đọc `process.env` ngoài `infra/config`.
- Thời gian lấy qua `Clock` port → test được job "30 phút" mà không phải chờ.
- Log có cấu trúc (JSON), luôn kèm `requestId`/`jobId`; không log mật khẩu, token, nội dung OTP.

**Git**
- Nhánh: `feat/<module>-<mô-tả>`, `fix/…`, `chore/…`. Commit theo Conventional Commits (`feat(orders): …`).
- `main` được bảo vệ: chỉ merge qua PR, bắt buộc CI xanh, không push trực tiếp, không force push.
- Mỗi PR nhỏ, một mục đích; mẫu PR có mục "Đã kiểm thử thế nào" và "Có migration không".
