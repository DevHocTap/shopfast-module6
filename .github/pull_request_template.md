## Thay đổi gì

<!-- Một PR một mục đích. Liên kết yêu cầu SRS nếu có (VD: F04.2). -->

## Đã kiểm thử thế nào

- [ ] Unit test
- [ ] Integration / e2e test
- [ ] Chạy thử cục bộ

## Checklist

- [ ] Có migration? Nếu có: tương thích ngược (expand → contract), bản cũ vẫn chạy được với schema mới
- [ ] Không có secret trong code / Dockerfile / compose / workflow
- [ ] Biến môi trường mới đã thêm vào `env.schema.ts`, `.env.example` và SSM (nếu là secret)
- [ ] Đã cập nhật `docs/` nếu đổi kiến trúc hoặc quyết định kỹ thuật
