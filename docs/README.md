# ShopFast — Tài liệu dự án

Bộ tài liệu này được viết từ [SRS](../srs.md). Đọc theo thứ tự:

| # | Tài liệu | Trả lời câu hỏi |
|---|----------|-----------------|
| 00 | [Kế hoạch & truy vết yêu cầu](00-project-plan.md) | Làm gì trước, làm gì sau; yêu cầu nào nằm ở module nào; kịch bản demo |
| 01 | [Kiến trúc tổng thể](01-architecture.md) | Hệ thống gồm những thành phần nào, chạy ở đâu trên AWS, dữ liệu chảy ra sao |
| 02 | [Danh sách module](02-modules.md) | Mỗi module NestJS làm gì, có endpoint/sự kiện/job nào, phụ thuộc gì |
| 03 | [Mô hình dữ liệu](03-data-model.md) | Bảng, quan hệ, ràng buộc giúp dữ liệu đúng (chống bán vượt, chống trùng lặp) |
| 04 | [Cấu trúc mã nguồn & quy ước](04-project-structure.md) | Cây thư mục monorepo, chia tầng, quy ước đặt tên |
| 05 | [Triển khai, CI/CD & vận hành](05-deployment-cicd.md) | Pipeline, triển khai blue/green, quay lui, IAM, secrets, sao lưu, giám sát |
| 06 | [Chiến lược kiểm thử](06-testing-strategy.md) | Kiểm thử đơn vị, tích hợp, tải, đánh giá AI; cách đạt ngưỡng 60% |
| 07 | [Quyết định kỹ thuật & xử lý sự cố](07-technical-decisions.md) | Vì sao chọn giải pháp này, khi hỏng thì hệ thống phản ứng thế nào (chuẩn bị bảo vệ) |
