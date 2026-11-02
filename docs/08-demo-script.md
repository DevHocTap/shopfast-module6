# 08 — Kịch bản demo 10 phút

Chuẩn bị: hai cửa sổ trình duyệt cạnh nhau (A: cửa sổ thường, B: ẩn danh), một terminal SSH vào EC2, tab GitHub Actions. Mật khẩu tài khoản demo lấy từ SSM (`/shopfast/prod/SEED_DEMO_PASSWORD`).

| Tài khoản | Vai trò | Dùng ở |
|-----------|---------|--------|
| `customer@shopfast.local` | Khách | Cửa sổ A |
| `warehouse@shopfast.local` | Kho | Cửa sổ B (phút 1–3) |
| `support@shopfast.local` | CSKH | Cửa sổ B (phút 6–8) |
| `admin@shopfast.local` | Quản trị | Cửa sổ B (phút 3–4) |

| Phút | Làm gì | Nói gì (ý chính) |
|------|--------|------------------|
| 0–1 | Sơ đồ kiến trúc ([01](01-architecture.md)); mở `https://shopfast.hmicodev.io.vn` | Một EC2 Sydney, Nginx TLS, blue/green api, worker riêng, PostgreSQL + Redis không lộ ra Internet |
| 1–3 | A: thêm giỏ → đặt hàng → thanh toán → mở trang đơn. B (kho): **Kho → Bắt đầu đóng gói**. A tự đổi sang "Đang đóng gói" < 1 s. A ở **Đơn hàng của tôi**, B bấm **Giao cho vận chuyển** → danh sách A tự cập nhật | F06 không bán vượt (UPDATE có điều kiện); F02 socket xác thực JWT lúc bắt tay, room theo đơn/người dùng, Redis adapter cho 2 bản api |
| 3–4 | A: hoá đơn đã có ("Xem hoá đơn"); email xác nhận (Mailpit/SES). B (admin): **Tác vụ nền** — số job, lỗi, nút Chạy lại | F05 outbox cùng transaction, retry + backoff, dead-letter, idempotent bằng unique key |
| 4–5 | Terminal: script dò mật khẩu → 429 tiếng Việt + khoá leo thang | F03 đếm theo tài khoản mục tiêu, không chỉ IP |
| 5–6 | Trang sản phẩm lần 1/lần 2 (DevTools → `Server-Timing`); đổi giá → thấy ngay; `docker stop shopfast-redis` → vẫn mua được; **Hệ thống** báo `degraded` | F04 cache-aside, version danh sách, fail-open + circuit breaker |
| 6–8 | A: trang đơn → **Cần hỗ trợ** → "Đặt nhầm, huỷ giúp". B (CSKH): **CSKH** → ticket đã được AI xếp nhóm → hỏi trợ lý "Đơn của khách đang ở đâu?" (thấy chip *Tra cứu đơn*) → "Viết bài thơ" (từ chối) → "Huỷ đơn này giúp khách" → **đề xuất chờ duyệt** → **Duyệt và huỷ đơn** → A thấy "Đã huỷ" ngay | F01: tool chỉ đọc + chỉ đề xuất; người duyệt thực thi dưới danh tính của mình, ghi `audit_logs`; rào chắn chặn câu bịa trạng thái; bộ đánh giá 20 + 15 ca |
| 8–10 | Sửa một dòng chữ → PR → CI 6 check → merge → Deploy blue/green (A vẫn đang theo dõi đơn, socket tự nối lại). Mở PR có test hỏng bị chặn, lần Deploy tự quay lui, alarm CloudWatch, lịch sử Uptime | CI/CD không khoá AWS trên GitHub (runner tại EC2 + instance role), quay lui tự động, giám sát từ ngoài |

Phương án dự phòng: video ghi sẵn toàn bộ kịch bản; nếu trợ lý AI không gọi được dịch vụ (mạng phòng thi, hết hạn mức) thì giao diện hiện "Tạm ngưng" — trình bày bằng video và kết quả bộ đánh giá trong `docs/reports/`.

Câu hỏi thường gặp và câu trả lời ngắn: [07 — mục 2](07-technical-decisions.md#2-hệ-thống-gặp-sự-cố-thì-sao-chuẩn-bị-trả-lời-hội-đồng).
