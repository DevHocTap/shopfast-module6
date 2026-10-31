# 07 — Quyết định kỹ thuật & xử lý sự cố

Tiêu chí "Bảo vệ quyết định kỹ thuật" là **điều kiện bắt buộc**. Tài liệu này gom các quyết định quan trọng theo dạng
*Bối cảnh → Quyết định → Đánh đổi*, và các câu hỏi hội đồng có thể hỏi kèm câu trả lời ngắn.

## 1. Bản ghi quyết định (ADR rút gọn)

### ADR-01 — Modular monolith + worker tách tiến trình
- **Bối cảnh:** 1 người phát triển, 1 EC2, tải 200.000 khách; cần tách tác vụ nặng khỏi request.
- **Quyết định:** một codebase NestJS, hai entrypoint `api` và `worker`.
- **Đánh đổi:** không scale từng phần độc lập như microservice; đổi lại triển khai, debug, giao dịch DB đơn giản. Ranh giới module rõ để tách sau này nếu cần.

### ADR-02 — Trừ kho bằng câu UPDATE có điều kiện
- **Bối cảnh:** không được bán vượt; nhiều khách đặt cùng lúc khi khuyến mãi.
- **Quyết định:** `UPDATE inventories SET quantity = quantity - n WHERE product_id = ? AND quantity >= n` trong transaction, kiểm tra số dòng; CHECK `quantity >= 0` làm lưới an toàn.
- **Đánh đổi:** so với `SELECT … FOR UPDATE`: ít round-trip hơn, khoá dòng ngắn hơn. So với trừ kho trên Redis: không có hai nguồn sự thật cần đồng bộ.

### ADR-03 — Transactional outbox thay vì đẩy job trực tiếp
- **Bối cảnh:** "đơn đã lưu nhưng job gửi email bị mất" khi Redis lỗi giữa chừng; SRS đòi suy giảm có kiểm soát.
- **Quyết định:** ghi sự kiện vào `outbox_events` trong cùng transaction với đơn; worker đẩy sang BullMQ.
- **Đánh đổi:** trễ thêm ≤ 1 s cho tác vụ nền; thêm một bảng và một vòng quét. Realtime **không** đi qua outbox để giữ < 1 s.

### ADR-04 — Idempotency bằng ràng buộc DB, không chỉ `jobId`
- **Bối cảnh:** BullMQ đảm bảo *at-least-once*; worker có thể chết sau khi gửi email nhưng trước khi đánh dấu xong.
- **Quyết định:** `jobId` chống đẩy trùng vào hàng đợi; **unique key trong DB** (`email_logs(type, ref_id)`, `invoices.order_id`…) chống thực thi trùng.
- **Đánh đổi:** với email, vẫn còn cửa sổ rất nhỏ "đã gửi nhưng chưa ghi SENT" → lần retry thấy trạng thái `SENDING` cũ hơn N phút thì kiểm tra `provider_message_id` trước khi gửi lại. Chấp nhận và nói rõ.

### ADR-05 — Cache-aside tự viết trên ioredis thay vì `cache-manager`
- **Bối cảnh:** cần khoá chống dồn dập, cache âm, version cho danh sách, circuit breaker, đếm hit/miss.
- **Quyết định:** `CacheService` riêng (~200 dòng) có test đầy đủ.
- **Đánh đổi:** tự bảo trì; đổi lại kiểm soát được hành vi lỗi và giải thích được từng dòng.

### ADR-06 — Làm mới danh sách bằng version thay vì xoá theo mẫu khoá
- **Bối cảnh:** một sản phẩm đổi giá ảnh hưởng vô số khoá danh sách (theo bộ lọc khoảng giá, thương hiệu…).
- **Quyết định:** khoá danh sách chứa `catalog:version`; đổi dữ liệu → `INCR` version.
- **Đánh đổi:** mọi danh sách mất cache cùng lúc sau mỗi thay đổi (giảm hit rate tạm thời) — chấp nhận vì tần suất đổi giá thấp hơn nhiều so với đọc. Không dùng `KEYS`/`SCAN` xoá theo mẫu (chặn Redis, không nguyên tử).

### ADR-07 — Socket.IO + Redis adapter
- **Bối cảnh:** cần reconnect tự động, room theo đơn, xác thực khi bắt tay, và 2 bản api cùng tồn tại lúc deploy.
- **Quyết định:** Socket.IO 4, namespace `/tracking`, room `order:{id}`, Redis adapter.
- **Đánh đổi:** client phải dùng thư viện Socket.IO (không phải WebSocket thuần); đổi lại không phải tự viết heartbeat/reconnect/room.

### ADR-08 — Blue/green trên một EC2 với Nginx
- **Bối cảnh:** không gián đoạn khi deploy, rollback < 2 phút, ngân sách 1 máy.
- **Quyết định:** 2 container `api-blue`/`api-green`, Nginx đổi upstream bằng reload.
- **Đánh đổi:** cần RAM cho 2 bản cùng lúc (chọn t3.medium); một EC2 vẫn là điểm lỗi đơn — khắc phục bằng sao lưu + script dựng lại; hướng mở rộng là ALB + Auto Scaling Group + RDS.

### ADR-09 — Instance role, không access key
- **Bối cảnh:** SRS cấm khoá dài hạn.
- **Quyết định:** EC2 dùng instance profile (credential tạm, tự xoay vòng). Ban đầu định cho GitHub Actions dùng OIDC + SSM Run Command, nhưng SCP của lớp chặn tạo OIDC provider → xem ADR-13.
- **Đánh đổi:** cấu hình IAM ban đầu phức tạp hơn; đổi lại không có gì để lộ.

### ADR-10 — PostgreSQL & Redis trong container trên cùng EC2
- **Bối cảnh:** SRS mô tả DB và Redis "trong cùng mạng nội bộ"; chi phí lớp học.
- **Quyết định:** container + volume, không publish cổng; sao lưu ra S3.
- **Đánh đổi:** tự lo sao lưu/khôi phục, không có failover tự động như RDS Multi-AZ. Nêu rõ RDS là bước tiếp theo khi lên production thật.

### ADR-12 — Region Sydney (`ap-southeast-2`)
- **Bối cảnh:** tài khoản AWS của lớp nằm trong một AWS Organization; Service Control Policy chặn mọi region khác Sydney.
- **Quyết định:** toàn bộ tài nguyên AWS (EC2, S3, SSM) ở `ap-southeast-2`.
- **Đánh đổi:** từ Việt Nam tới Sydney mất khoảng 120–180 ms khứ hồi (Singapore khoảng 30–50 ms). Vì vậy ngưỡng SRS "p95 < 50 ms" được đo **tại máy chủ** (`upstream_response_time` của Nginx, header `Server-Timing`, k6 chạy trong cùng region), không đo từ trình duyệt ở Việt Nam. Khi lên production thật sẽ chọn Singapore và đặt CDN trước phần web tĩnh.

### ADR-13 — Deploy bằng self-hosted runner trên EC2, image trên GHCR
- **Bối cảnh:** SCP của lớp chặn `iam:CreateOpenIDConnectProvider` (và yêu cầu nâng cấp gói), nên GitHub Actions không thể nhận credential AWS tạm thời qua OIDC. SRS cấm access key dài hạn.
- **Quyết định:** build image trên runner của GitHub, đẩy lên GHCR bằng `GITHUB_TOKEN` (tự cấp cho từng job, hết hạn khi job xong). Job deploy/rollback chạy trên **self-hosted runner cài tại EC2**, dùng instance role cho mọi lệnh AWS. Runner chỉ mở kết nối ra ngoài tới GitHub — không mở thêm cổng.
- **Đánh đổi:** runner có quyền Docker trên máy production (tương đương root), nên ai chạy được workflow trên nó là chạy được lệnh trên máy. Giảm rủi ro: chỉ `deploy.yml` (kích hoạt bởi push `main` hoặc người có quyền ghi) nhắm nhãn `shopfast-prod`; repo bật **"Require approval for all external contributors"** để PR từ fork không tự chạy; `main` được bảo vệ. Token đăng ký runner dùng một lần và hết hạn sau 1 giờ.

### ADR-14 — Rate limit tự viết thay vì `@nestjs/throttler`
- **Bối cảnh:** SRS cần (1) một hạn mức chung cho *toàn bộ* API mỗi user/IP, (2) hạn mức riêng chặt hơn cho login, OTP, đơn khuyến mãi, (3) khoá theo tài khoản bị nhắm tới, (4) 429 tiếng Việt, và theo yêu cầu độ tin cậy, (5) vẫn hoạt động khi Redis chết.
- **Quyết định:** guard toàn cục đặt sau `JwtAuthGuard` (nên biết user là ai), chính sách khai báo một chỗ (`policies.ts`). Bộ đếm cửa sổ cố định dùng một script Lua (INCR + PEXPIRE nguyên tử) trên Redis. Khi Redis lỗi, chuyển sang bộ đếm trong bộ nhớ của từng tiến trình.
- **Đánh đổi:** `@nestjs/throttler` đếm theo từng route (không có "toàn API") và không có dự phòng, tuỳ biến đủ các ý trên cũng tốn công gần bằng tự viết. Cửa sổ cố định có thể cho qua tối đa khoảng 2× hạn mức ở ranh giới hai cửa sổ; chấp nhận được vì mục tiêu là chặn lạm dụng, không phải tính tiền. Khi dùng bộ nhớ, hạn mức thành theo từng tiến trình (lỏng hơn) nhưng không bao giờ tắt hẳn.

### ADR-15 — Tách cache thông tin/giá khỏi cache tồn kho
- **Bối cảnh:** F04 đòi "giá hoặc tồn kho đổi thì bản ghi đệm liên quan phải làm mới ngay", đồng thời tỉ lệ trúng ≥ 80%. Tồn kho đổi sau *mỗi* đơn hàng; nếu xoá cả trang danh sách mỗi lần như vậy, tỉ lệ trúng sẽ rất thấp.
- **Quyết định:** `product:{id}` và `catalog:list:v{n}:{hash}` chỉ chứa dữ liệu ít đổi (tên, giá, phân loại), TTL 5–10 phút. Đổi giá thì xoá `product:{id}` và tăng `version:catalog`, khiến mọi khoá danh sách cũ không còn ai đọc tới. Tồn kho lưu riêng ở `stock:{id}` (TTL 60 giây), đọc hàng loạt bằng `MGET`, và bị xoá ngay **sau khi commit** đặt hàng, huỷ đơn hoặc kiểm kê. Mọi lần xoá đều xoá lần hai sau 500 ms, để đuổi giá trị cũ do một request đọc chạy chen ghi lại.
- **Đánh đổi:** mỗi lần đọc danh sách tốn 3 lượt gọi Redis (version, danh sách, `MGET` tồn kho) thay vì 1. Đổi lại, đo được tỉ lệ trúng 99,6% với khoảng 1.200 request/giây ([báo cáo tải](reports/load-test-local-2026-10-31.md)). Lúc đặt hàng vẫn đọc giá và tồn kho từ DB, nên cache có trễ thì khách cũng không bao giờ bị tính sai.

### ADR-11 — Trợ lý AI chỉ được "đề xuất", con người "thực thi"
- **Bối cảnh:** LLM có thể sai hoặc bị prompt injection; SRS bắt buộc người xác nhận thao tác ghi.
- **Quyết định:** không có tool ghi; `propose_action` chỉ tạo bản ghi; thực thi bằng endpoint riêng, danh tính nhân viên, có audit.
- **Đánh đổi:** thêm một bước bấm; đổi lại sai sót của AI không thể tự gây thiệt hại.

## 2. Hệ thống gặp sự cố thì sao? (chuẩn bị trả lời hội đồng)

| Câu hỏi | Trả lời ngắn |
|---------|--------------|
| Redis chậm/chết thì mỗi request có phải đợi timeout không? | Không. Lệnh Redis có timeout 200 ms; sau 5 lỗi liên tiếp, circuit breaker mở và mọi request bỏ qua Redis ngay trong 10 giây, rồi thử lại một lần (half-open). |
| Redis chết giữa buổi demo? | Cache fail-open (breaker mở, đọc DB, chậm hơn); rate limit chuyển bộ đếm trong bộ nhớ; đơn vẫn đặt được vì sự kiện nằm trong outbox; `/health/ready` báo `degraded`. Redis sống lại → breaker đóng sau 10 s, relay đẩy job tồn. |
| PostgreSQL chết? | Đây là phụ thuộc bắt buộc: `/health/ready` 503, Nginx trả trang lỗi thân thiện. Container có `restart: unless-stopped`. Mất dữ liệu đĩa → khôi phục từ S3 theo runbook (RTO đã đo). |
| Deploy bản lỗi? | Health check của màu mới không đạt → traffic không bao giờ chuyển. Lỗi chỉ lộ sau khi chuyển → smoke test bắt được → `rollback.sh` trỏ lại màu cũ trong vài giây. |
| Migration lỗi giữa chừng? | Migration chạy trước khi khởi động bản mới, trong transaction; lỗi → pipeline dừng, bản cũ vẫn chạy. Quy tắc expand/contract đảm bảo bản cũ tương thích schema mới. |
| Hai khách cùng mua món cuối cùng? | Câu UPDATE có điều kiện: chỉ một transaction thấy `quantity >= 1`; người còn lại nhận 409. Có test 50 request đồng thời chứng minh. |
| Worker chết khi đang gửi email? | Job không được ack → BullMQ đưa lại (stalled job). Bản ghi `email_logs` ngăn gửi lần hai. |
| Đối tác kho sập cả ngày? | Retry backoff ~10 phút rồi vào `failed_jobs`; đơn không bị ảnh hưởng; admin bấm chạy lại khi đối tác sống. Khoá idempotency ở đối tác chống áp dụng 2 lần. |
| Cache trả giá cũ? | Xoá cache ngay sau commit + xoá lần 2 sau 500 ms; danh sách dùng version. Lúc đặt hàng luôn lấy giá từ DB nên khách không bao giờ trả theo giá cũ. |
| Hàng nghìn request cùng hỏi một sản phẩm vừa hết hạn cache? | Singleflight trong tiến trình + khoá Redis `SET NX`: chỉ 1 request đọc DB, số còn lại chờ và đọc cache. TTL có jitter để các khoá không hết hạn cùng lúc. |
| Bot dò ID sản phẩm không tồn tại? | Kiểm tra định dạng ID trước; ID hợp lệ nhưng không có → cache âm 60 s; cộng thêm rate limit chung. |
| Kẻ tấn công đổi IP liên tục để dò mật khẩu 1 tài khoản? | Khoá leo thang đếm **theo tài khoản mục tiêu**, không theo IP → đổi IP không giúp được. |
| Vậy kẻ xấu cố tình khoá tài khoản người khác? | Thời gian khoá ngắn ở các mức đầu, gửi email cảnh báo chủ tài khoản; mở rộng: yêu cầu CAPTCHA thay vì khoá cứng. Nêu rõ đây là đánh đổi bảo mật ↔ khả dụng. |
| Người dùng sau NAT (cùng IP) bị chặn oan? | Khi đã đăng nhập, hạn mức đếm theo tài khoản; chỉ request ẩn danh mới đếm theo IP, và hạn mức ẩn danh đủ rộng cho trang công khai. |
| Lộ secret? | Đổi trong SSM → chạy lại deploy cùng SHA (render-env lấy giá trị mới). Không có khoá AWS dài hạn để lộ. Gitleaks chặn từ PR. |
| Mất cả EC2? | Dựng EC2 mới theo `infra/aws/README.md`, khôi phục DB từ S3, cài lại runner (`setup-runner.sh`), chạy Deploy với SHA tốt gần nhất (image còn trên GHCR). RPO 24 h. |
| LLM trả lời bịa? | Prompt cấm + kiểm tra đầu ra (mã đơn nhắc tới phải có trong tool_result) + nhân viên đọc trước khi gửi khách; mọi hành động ghi cần duyệt. |
| Khoá LLM hết hạn mức? | Adapter bắt lỗi → phân loại thành `UNCLASSIFIED`, chat báo trợ lý tạm ngưng; hạn mức `ai` 20 req/phút/nhân viên kiểm soát chi phí. |
| Vì sao không dùng Kubernetes/ECS? | Một máy, một người vận hành; Compose + script blue/green đáp ứng đủ yêu cầu không gián đoạn và quay lui, dễ giải thích. |

## 3. Hướng mở rộng (nêu khi được hỏi "tương lai")
- ALB + Auto Scaling Group cho api; RDS PostgreSQL Multi-AZ; ElastiCache Redis.
- Tách `worker` thành nhiều worker theo queue để scale riêng.
- Đa nhà bán hàng: thêm `sellers`, tách đơn theo seller, phân quyền theo tenant.
- Cổng thanh toán thật: webhook + idempotency theo `payment_intent_id`, đối soát hằng đêm.
- Quan sát: OpenTelemetry tracing xuyên api → queue → worker.
