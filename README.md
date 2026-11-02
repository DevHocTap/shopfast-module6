# ShopFast

Backend cho một sàn thương mại điện tử quy mô khoảng 200.000 khách hàng, kèm giao diện web để
mua sắm, theo dõi đơn hàng và vận hành.

Bản chạy thật: https://shopfast.hmicodev.io.vn

## Chức năng chính

- **Mua sắm:** danh mục có lọc và phân trang, giỏ hàng, đặt đơn không bán vượt tồn kho, mã giảm giá.
- **Theo dõi đơn hàng trực tiếp:** trạng thái đơn tự cập nhật trên màn hình, không cần tải lại trang.
- **Kho:** hàng đợi đơn cần xử lý, cập nhật trạng thái giao hàng, kiểm kê tồn kho.
- **Chăm sóc khách hàng:** ticket hỗ trợ, trợ lý AI tra cứu đơn và tồn kho; mọi thao tác thay đổi
  dữ liệu đều do nhân viên duyệt.
- **Tác vụ nền:** email xác nhận, hoá đơn, đồng bộ tồn kho với đối tác, nhắc thanh toán, báo cáo
  doanh thu hằng đêm, có thử lại tự động.
- **Bảo vệ và hiệu năng:** giới hạn tần suất truy cập, khoá chống dò mật khẩu, bộ nhớ đệm cho dữ
  liệu sản phẩm.

## Công nghệ

NestJS · TypeScript · PostgreSQL · Redis · BullMQ · Socket.IO · React + Vite · Docker ·
GitHub Actions · AWS.

## Cấu trúc

```
apps/api     API và worker xử lý tác vụ nền
apps/web     Giao diện web
infra/       Docker, Nginx và script triển khai
```
