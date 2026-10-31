# ShopFast — hướng dẫn cho Claude

Đề bài: [srs.md](srs.md). Kiến trúc và kế hoạch: [docs/](docs/README.md) — đọc trước khi viết code.

## Bất biến kiến trúc (không phá vỡ khi chưa cập nhật docs/07)
- NestJS 10 / Node 20 / PostgreSQL 16 / Redis 7 / TypeScript strict. Monorepo pnpm: `apps/api`, `apps/web`.
- Hai entrypoint từ cùng codebase: `api` (HTTP + Socket.IO) và `worker` (BullMQ, outbox relay, job theo lịch).
- Tầng: controller → service → repository. Service không import kiểu HTTP/Socket; phụ thuộc bên ngoài qua port (`CacheService`, `LlmPort`, `MailPort`, `Clock`).
- Trừ kho/voucher bằng `UPDATE … WHERE quantity >= n`; giá khi đặt hàng luôn đọc từ DB.
- Tác vụ nền đi qua `outbox_events` trong cùng transaction; mọi processor phải idempotent bằng unique key trong DB.
- Lỗi Redis không được làm hỏng request (fail-open). Chỉ DB là phụ thuộc bắt buộc.
- Trợ lý AI không có tool ghi; thao tác ghi chỉ qua `agent_actions` được nhân viên duyệt.
- Không secret trong code, Dockerfile, compose, workflow. Không đọc `process.env` ngoài `infra/config`.
- Migration phải tương thích ngược (expand → contract) vì deploy blue/green.

## Môi trường máy dev
- `pnpm` chưa có trên PATH: gọi `corepack pnpm@9.15.4 <lệnh>` (script gốc dùng `pnpm -r` cần `corepack enable`).
- Cổng 5432 đang bị container `kpi-postgres` (dự án khác) chiếm → chạy `PG_PORT=5433 pnpm infra:up`, `DB_PORT=5433` trong `apps/api/.env`. Không dừng container đó.
- Không có Python; dùng Node hoặc bash cho script phụ.

## Quy ước
- Thông điệp lỗi trả cho người dùng bằng tiếng Việt (tập trung ở `common/filters/messages.vi.ts`).
- Mỗi service mới phải có `*.spec.ts`; ngưỡng coverage tầng nghiệp vụ 60% (mục tiêu 70%).
- Conventional Commits; mọi thay đổi vào `main` qua PR.
