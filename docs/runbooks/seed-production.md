# Runbook — Nạp dữ liệu demo lên production

Script seed tạo 12 danh mục, 25 thương hiệu, 1.000 sản phẩm kèm tồn kho, 4 tài khoản nhân viên/demo,
200 khách hàng và khoảng 3.000 đơn hàng trong 60 ngày gần nhất. Script **chỉ chạy khi chưa có sản phẩm nào**,
nên chạy lại cũng không tạo trùng.

## Tài khoản được tạo
| Email | Vai trò |
|-------|---------|
| `admin@shopfast.local` | ADMIN |
| `support@shopfast.local` | SUPPORT |
| `warehouse@shopfast.local` | WAREHOUSE |
| `customer@shopfast.local` | CUSTOMER |
| `customer001…200@shopfast.local` | CUSTOMER |

Tất cả dùng chung mật khẩu lấy từ `SEED_DEMO_PASSWORD`. Mật khẩu này **không nằm trong repo**.

## Các bước
1. Tạo tham số SSM (SecureString) `/shopfast/prod/SEED_DEMO_PASSWORD`, ít nhất 8 ký tự,
   rồi chạy lại Deploy (hoặc `render-env.sh`) để đưa nó vào `shared/.env`.
2. Trên EC2 (Session Manager):
   ```bash
   COLOR=$(cat /opt/shopfast/shared/state/active_color)
   sudo docker exec "shopfast-api-$COLOR" node dist/infra/database/seeds/seed.js
   ```
   Kết quả mong đợi: `Seeded 12 categories, 25 brands, 1000 products, 204 users, 3000 orders.`
3. Kiểm tra: `curl -s https://shopfast.hmicodev.io.vn/api/products?limit=1`

Trước buổi bảo vệ, nên đổi mật khẩu tài khoản `admin@shopfast.local` hoặc xoá tham số SSM khi không cần nữa:
repo đang public và trang chạy thật.
