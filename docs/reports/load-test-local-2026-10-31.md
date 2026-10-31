# Báo cáo tải — catalog có cache (chạy cục bộ, 31/10/2026)

**Mục đích:** kiểm chứng F04 và bảng hiệu năng của SRS: tra cứu có cache p95 < 50 ms, tỉ lệ trúng ≥ 80%.

**Môi trường:** laptop Windows 11, API là **một** tiến trình Node 22 (`node dist/main.js`, `NODE_ENV=production`,
`RATE_LIMIT_ENABLED=false`), PostgreSQL 16 và Redis 7 trong Docker Desktop, dữ liệu seed 1.000 sản phẩm.
k6 chạy trong Docker và gọi qua `host.docker.internal`; mạng ảo này cộng thêm vài ms vào mỗi request.

**Kịch bản** ([tests/load/catalog.js](../../tests/load/catalog.js)): 70% xem chi tiết sản phẩm, độ phổ biến lệch kiểu
Zipf trên 200 sản phẩm; 30% xem danh sách theo danh mục, ngẫu nhiên kiểu sắp xếp, trang 1–3.

| Lần chạy | Request/giây | p95 chi tiết | p95 danh sách | Thời gian xử lý ở server, p95 (`Server-Timing`) | Lỗi |
|---|---|---|---|---|---|
| 50 VU × 1 phút | 1.266 | 42,9 ms ✅ | 57,8 ms ❌ | 32,6 ms | 0% |
| 10 VU × 30 giây | 1.128 | **9,8 ms ✅** | **12,8 ms ✅** | **7,2 ms** | 0% |

**Tỉ lệ trúng cache** (`GET /api/admin/cache/stats` sau lần 50 VU): 79.866 hit / 339 miss = **99,6%** ✅

## Nhận xét
- Thông lượng gần như không đổi giữa 10 và 50 VU, nên khoảng 1.200 request/giây là trần của **một** tiến trình Node trên máy này.
  Ở 50 VU, request phải xếp hàng chờ event loop, p95 tăng theo. Đây là quá tải, không phải cache chậm.
- Khi chưa quá tải, cả hai endpoint đạt p95 khoảng 10–13 ms qua mạng ảo Docker; thời gian xử lý ở server p95 là 7 ms.
- Lần đọc đầu (MISS) mất khoảng 10 ms, các lần sau (HIT) khoảng 3 ms, theo header `Server-Timing`.
- Danh sách tốn hơn chi tiết 3 lượt gọi Redis: đọc version, đọc trang danh sách, rồi `MGET` tồn kho.

## Việc tiếp theo
- Đo lại trên EC2 ở Sydney (t3.small, qua Nginx), chạy k6 ngay trong region (ADR-12).
- Muốn vượt trần một tiến trình: chạy nhiều bản API sau Nginx (Node cluster), hoặc nâng lên t3.medium.
