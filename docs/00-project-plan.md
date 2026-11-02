# 00 — Kế hoạch dự án & truy vết yêu cầu

## 1. Hướng tiếp cận

Ba nguyên tắc dẫn dắt toàn bộ kế hoạch, rút ra trực tiếp từ bảng chấm điểm:

1. **Triển khai sớm, triển khai liên tục ("walking skeleton").** 45% điểm (sản phẩm chạy thật 25% + tự động hoá triển khai 20%)
   phụ thuộc vào hạ tầng. Vì vậy tuần đầu tiên phải có một API "hello + health" chạy trên EC2 qua HTTPS bằng pipeline tự động.
   Mọi tính năng sau đó được giao qua đúng pipeline này → đến ngày bảo vệ pipeline đã chạy hàng chục lần.
2. **Modular monolith + worker tách tiến trình.** Một codebase NestJS, chia module theo nghiệp vụ, build ra hai entrypoint:
   `api` (HTTP + WebSocket) và `worker` (BullMQ + lịch chạy). Đủ đơn giản cho một người vận hành, đủ tách bạch để giải thích.
3. **Mỗi chủ đề Module 6 giải quyết một bài toán nghiệp vụ cụ thể** (tiêu chí "Mức độ tích hợp" 25%). Không làm tính năng
   để "có cho đủ" — mỗi chủ đề phải trả lời được: *nếu không có nó, ShopFast gặp vấn đề gì?*

| Chủ đề | Bài toán nghiệp vụ ShopFast |
|--------|-----------------------------|
| AI Agent (S01) | Nhân viên CSKH mất thời gian mở nhiều màn hình để tra đơn/tồn kho; ticket bị phân sai nhóm |
| Realtime (S02) | Khách liên tục F5 / gọi hotline hỏi "đơn tôi tới đâu rồi" |
| Rate limiting (S03) | Bot dò mật khẩu, spam OTP tốn tiền SMS/email, bot vét hàng khuyến mãi |
| Caching (S04) | Trang sản phẩm/danh mục bị đọc nhiều gấp hàng trăm lần so với ghi, DB quá tải giờ cao điểm |
| Background jobs (S05) | Gửi email/xuất hoá đơn làm chậm đặt hàng; đối tác chập chờn làm hỏng đơn |
| Container + CI/CD + Cloud (S06–S08) | Triển khai thủ công dễ sai, không quay lui được, lộ khoá truy cập |

## 2. Lộ trình theo giai đoạn

Mỗi giai đoạn kết thúc bằng một **PR được merge và tự triển khai lên môi trường thật**. Không chuyển giai đoạn khi "Định nghĩa hoàn thành" chưa đạt.

### Giai đoạn 0 — Nền móng & walking skeleton
- Monorepo pnpm (`apps/api`, `apps/web`), ESLint + Prettier, Husky pre-commit, tsconfig strict.
- NestJS 10: `ConfigModule` có kiểm tra biến môi trường, logger `nestjs-pino`, `HealthModule` (DB + Redis).
- Dockerfile multi-stage cho `api`, `web` (Nginx phục vụ bản build tĩnh); `docker-compose.yml` cho máy cục bộ.
- AWS: tài khoản theo chuẩn S07 (IAM group + MFA), EC2 + Security Group, Elastic IP, tên miền + Let's Encrypt, S3 backup, SSM Parameter Store.
- GitHub: branch protection trên `main`, self-hosted runner trên EC2 (OIDC bị SCP của lớp chặn), workflow `ci.yml` + `deploy.yml` (blue/green + rollback).

**Định nghĩa hoàn thành:** `https://<domain>/api/health` trả `ok` cho cả DB và Redis; một commit vào `main` tự lên production trong < 10 phút; cố tình làm hỏng health check → tự quay lui.

### Giai đoạn 1 — Nghiệp vụ lõi (F06)
- `auth` (JWT access + refresh xoay vòng, 4 vai trò), `users`.
- `catalog` (danh mục, thương hiệu, sản phẩm, lọc + phân trang), `inventory`.
- `cart`, `orders` (đặt đơn trong transaction, trừ kho có điều kiện, máy trạng thái đơn), `payments` (giả lập).
- Seed script: ~1.000 sản phẩm, ~200 khách, ~5.000 đơn. Swagger tại `/api/docs`.
- Web: đăng nhập, danh sách/chi tiết sản phẩm, giỏ hàng, đặt hàng, lịch sử đơn; màn hình kho cập nhật trạng thái.

**Định nghĩa hoàn thành:** test tích hợp "50 request đặt đồng thời cho 10 sản phẩm tồn" → đúng 10 đơn thành công, tồn kho = 0.

### Giai đoạn 2 — Bảo vệ & tăng tốc (F03, F04)
- `rate-limit`: Throttler lưu trên Redis, khoá theo user/IP, hạn mức riêng cho login/OTP/đơn khuyến mãi, 429 tiếng Việt, khoá leo thang chống dò mật khẩu.
- `cache`: cache-aside cho chi tiết sản phẩm + danh sách có lọc, làm mới khi giá/tồn đổi, khoá chống dồn dập, cache âm, fail-open khi Redis chết.

**Định nghĩa hoàn thành:** k6 cho p95 tra cứu < 50 ms, tỉ lệ trúng cache ≥ 80%; tắt Redis → API vẫn trả dữ liệu.

### Giai đoạn 3 — Tác vụ nền (F05)
- `outbox` + worker relay; các hàng đợi `email`, `invoice`, `inventory-sync`, `payment-reminder`, `report`.
- Retry + exponential backoff, dead-letter (bảng `failed_jobs`), idempotency bằng khoá duy nhất trong DB.
- Lịch: nhắc thanh toán sau 30 phút (delayed job), báo cáo doanh thu 00:05 hằng đêm (repeatable job).
- Trang admin "Tác vụ nền": số job chờ / đang chạy / hẹn giờ / lỗi, tác vụ lỗi + nút chạy lại, báo cáo doanh thu.
- Email: `MAIL_TRANSPORT=ses` trên production (thử trước), dự phòng `smtp` (Gmail); Mailpit khi chạy local.

**Định nghĩa hoàn thành:** chạy lại một job email 3 lần → khách nhận đúng 1 email; giả lập đối tác lỗi → job vào DLQ kèm lý do.

### Giai đoạn 4 — Realtime (F02)
- `tracking` gateway Socket.IO, xác thực JWT khi bắt tay, room `order:{id}`, kiểm tra quyền sở hữu khi subscribe, Redis adapter.
- Web: màn hình theo dõi đơn, tự kết nối lại và đăng ký lại.

**Định nghĩa hoàn thành:** kho đổi trạng thái → màn hình khách cập nhật < 1 s; khách B không nhận được sự kiện đơn của khách A; tắt mạng 10 s rồi bật lại → vẫn nhận cập nhật.

> **Kiểm chứng:** `test/integration/realtime.int-spec.ts` chạy **2 bản api** chung PostgreSQL + Redis (request vào bản A, socket ở bản B): từ chối bắt tay không token, khách B bị `FORBIDDEN`, sự kiện tới < 1 s và không lọt sang khách B, rớt transport → tự kết nối, đăng ký lại và nhận sự kiện kế tiếp.

### Giai đoạn 5 — Trợ lý AI cho CSKH (F01)
- `support` (ticket + tin nhắn), `ai-assistant` (phân loại ticket, agent có 2 tool tra cứu, đề xuất hành động ghi chờ duyệt).
- Bộ đánh giá AI (~20 tình huống): ngoài phạm vi, bịa đơn hàng, prompt injection.

**Định nghĩa hoàn thành:** bộ đánh giá pass ≥ 90%; mọi hành động ghi đều có bản ghi `agent_actions` với người duyệt.

### Giai đoạn 6 — Hoàn thiện vận hành & bàn giao (F07)
- Sao lưu hằng ngày lên S3 + **diễn tập khôi phục thật** (ghi biên bản, đo thời gian < 30 phút).
- CloudWatch alarm + giám sát uptime bên ngoài; báo cáo độ phủ kiểm thử.
- Tạo một PR có test hỏng có chủ đích → pipeline chặn merge (lưu link làm bằng chứng).
- Hoàn thiện tài liệu kiến trúc, slide 10 phút, kịch bản demo, tập dượt trả lời câu hỏi (xem [07](07-technical-decisions.md)).

> **Thứ tự ưu tiên khi thiếu thời gian:** G0 → G1 → G2 → G3 → G4 → G6 → G5. Bảng chấm cần tối thiểu 5 chủ đề;
> hạ tầng (G0, G6) và nghiệp vụ lõi (G1) là bắt buộc để có bất kỳ điểm nào.

## 3. Ma trận truy vết yêu cầu

| Mã | Yêu cầu (rút gọn) | Module / thành phần | Cách kiểm chứng |
|----|-------------------|---------------------|-----------------|
| F01.1 | Phân loại ticket tự động | `ai-assistant` (job `ai-classify`) | Test đơn vị với LLM giả lập; bộ đánh giá |
| F01.2 | ≥ 2 tool tra cứu (đơn, tồn kho) | `ai-assistant/tools` | Test tích hợp gọi tool → dữ liệu DB thật |
| F01.3 | Từ chối ngoài phạm vi, không bịa | System prompt + kiểm tra đầu ra | Bộ đánh giá AI |
| F01.4 | Thao tác ghi phải được người duyệt | `agent_actions` (PROPOSED → APPROVED) | Test: tool không có quyền ghi trực tiếp |
| F02.1 | Cập nhật không cần tải lại | `tracking` gateway + web | Demo 2 cửa sổ |
| F02.2 | Chỉ gửi đúng người theo dõi | Room `order:{id}` | Test e2e 2 client |
| F02.3 | Xác thực khi bắt tay, chỉ đơn của mình | WS middleware + kiểm tra sở hữu | Test e2e token sai / đơn người khác |
| F02.4 | Tự kết nối lại + đăng ký lại | Hook `useOrderTracking` trên web | Demo tắt/bật mạng |
| F03.1 | Hạn mức toàn cục + riêng cho endpoint nhạy cảm | `rate-limit` (named throttlers) | Test e2e |
| F03.2 | Khoá theo user hoặc IP | `UserOrIpThrottlerGuard` | Test đơn vị |
| F03.3 | 429 + thời gian chờ + tiếng Việt | `ThrottlerExceptionFilter` | Test e2e |
| F03.4 | Chặn leo thang dò mật khẩu theo tài khoản | `LoginAttemptService` | Test đơn vị + e2e |
| F04.1 | Cache chi tiết + danh mục có lọc, lần 2 < 20 ms | `CacheService` + `catalog` | k6 / log thời gian |
| F04.2 | Làm mới ngay khi giá/tồn đổi | Xoá khoá + tăng version sau commit | Test tích hợp |
| F04.3 | Chống dồn dập + chống dò khoá không tồn tại | Khoá phân tán + singleflight; cache âm | Test đơn vị |
| F04.4 | Redis chết vẫn phục vụ | Fail-open + circuit breaker | Demo `docker stop redis` |
| F05.1 | Email, hoá đơn, đồng bộ đối tác qua hàng đợi | `outbox` → BullMQ | Đo p95 đặt hàng |
| F05.2 | Retry + backoff + DLQ kèm lý do | Cấu hình job + `failed_jobs` | Test tích hợp với đối tác giả lập lỗi |
| F05.3 | Bất biến khi lặp | `jobId` + unique key trong DB | Test chạy lại job |
| F05.4 | Nhắc thanh toán 30', báo cáo hằng đêm | Delayed job + repeatable job | Test với thời gian giả lập |
| F06.1 | Lọc danh mục/giá/thương hiệu + phân trang | `catalog` | Test e2e |
| F06.2 | Giỏ hàng, đặt đơn, không bán vượt | `cart`, `orders`, `inventory` | Test đồng thời |
| F06.3 | Lịch sử đơn, kho cập nhật trạng thái | `orders` | Test e2e |
| F06.4 | JWT + phân quyền vai trò | `auth` (`RolesGuard`) | Test e2e |
| F07.1 | Health DB + Redis | `health` | Pipeline gọi sau triển khai |
| F07.2 | Bảng theo dõi hàng đợi | `admin` + Bull Board | Demo |
| F07.3 | Tài liệu API tự sinh | Swagger `/api/docs` | Truy cập staging |
| F07.4 | Sao lưu hằng ngày, nơi tách biệt | `backup.sh` → S3 | Biên bản diễn tập |

Ngưỡng phi chức năng và cách đo được liệt kê ở [06 — Chiến lược kiểm thử](06-testing-strategy.md#4-kiểm-chứng-ngưỡng-phi-chức-năng).

## 4. Khung kịch bản demo (10 phút)

| Phút | Nội dung | Chủ đề chứng minh |
|------|----------|-------------------|
| 0–1 | Sơ đồ kiến trúc AWS, mở `https://<domain>` | Cloud, HTTPS |
| 1–3 | Khách đặt hàng → mở màn hình theo dõi; cửa sổ thứ 2 là nhân viên kho đổi trạng thái → khách thấy ngay | F06, F02 |
| 3–4 | Email xác nhận đến (Mailpit/SES), hoá đơn PDF; trang admin hàng đợi | F05 |
| 4–5 | Dò mật khẩu bằng script → 429 tiếng Việt, khoá leo thang | F03 |
| 5–6 | So sánh thời gian lần 1/lần 2 trang sản phẩm; đổi giá → khách thấy giá mới ngay; `docker stop redis` → vẫn chạy | F04 |
| 6–8 | Nhân viên CSKH hỏi trợ lý AI về đơn; hỏi ngoài phạm vi → từ chối; AI đề xuất huỷ đơn → nhân viên duyệt | F01 |
| 8–10 | Commit nhỏ → pipeline chạy → triển khai không gián đoạn (một client đang theo dõi vẫn nhận sự kiện); cho xem lần pipeline bị chặn và lần tự quay lui | CI/CD |

> Ghi hình trước một bản demo đầy đủ làm phương án dự phòng nếu mạng ở phòng bảo vệ có sự cố.
