# Runbook — Trợ lý AI cho CSKH (F01)

## 1. Bật trợ lý trên production

Khoá API không nằm trong repo, image hay workflow. Lưu trong SSM (SecureString); `render-env.sh` tự đưa mọi tham số dưới `/shopfast/prod/` vào `.env` của api và worker.

```bash
# Trên EC2 (instance role có quyền ssm:PutParameter) hoặc máy quản trị có quyền tương đương
aws ssm put-parameter --region ap-southeast-2 --type SecureString \
  --name /shopfast/prod/ANTHROPIC_API_KEY --value '<khoá>' --overwrite
# Tuỳ chọn: đổi model (mặc định claude-opus-5-5)
aws ssm put-parameter --region ap-southeast-2 --type String \
  --name /shopfast/prod/LLM_MODEL --value claude-opus-5-5 --overwrite
```

Sau đó chạy lại workflow **Deploy** với SHA hiện tại (render-env đọc giá trị mới). Kiểm tra:
- Trang `/desk/<ticket>` không còn nhãn "Tạm ngưng".
- Log worker không còn dòng `ANTHROPIC_API_KEY not set`.
- Ticket mới được gán nhóm trong vài giây (trang **Tác vụ nền** có hàng đợi "Phân loại ticket (AI)").

Tắt khẩn cấp (chi phí tăng bất thường, khoá lộ): xoá tham số rồi deploy lại → trợ lý chuyển "Tạm ngưng", mọi chức năng khác không đổi.

```bash
aws ssm delete-parameter --region ap-southeast-2 --name /shopfast/prod/ANTHROPIC_API_KEY
```

Kiểm soát chi phí: hạn mức `ai` 20 lượt/phút/nhân viên; tối đa 5 vòng tool mỗi câu trả lời; phân loại dùng effort `low`.

## 2. Chạy bộ đánh giá (`test/ai-eval`)

Chạy với model thật, trên **database test** (bị xoá sạch trước khi chạy):

```bash
PG_PORT=5433 pnpm infra:up
cd apps/api
DB_NAME=shopfast_test REDIS_DB=1 NODE_ENV=test ANTHROPIC_API_KEY=<khoá> pnpm ai:eval
# chạy thử khung chấm điểm, không tốn tiền:   ... pnpm ai:eval --fake
# chỉ một nhóm ca:                            ... pnpm ai:eval --only injection
```

- 20 ca hội thoại (`cases.json → chat`): tra cứu đúng, không bịa, mã không tồn tại, tồn kho, ngoài phạm vi, prompt injection, thao tác ghi. Chấm bằng luật: tool phải / không được gọi, chữ phải / không được xuất hiện, có tạo đề xuất hay không.
- 15 ticket có nhãn (`cases.json → classify`).
- Đạt khi hội thoại ≥ 90 % **và** phân loại ≥ 85 %; mã thoát khác 0 nếu không đạt. Kết quả chi tiết: `test/ai-eval/result-live.json` (không commit) — chép bảng tổng hợp vào `docs/reports/` làm bằng chứng.

Khi sửa prompt (`assistant.prompts.ts`) hoặc đổi `LLM_MODEL`: chạy lại bộ đánh giá trước khi merge.

## 3. Kịch bản demo (phút 6–8)

1. Khách (`customer@shopfast.local`) mở một đơn **Đã thanh toán** → **Cần hỗ trợ** → "Mình đặt nhầm, huỷ giúp đơn này".
2. Nhân viên (`support@shopfast.local`) mở **CSKH**: ticket đã được AI xếp nhóm.
3. Trong khung Trợ lý: "Đơn của khách đang ở đâu?" → thấy chip "Tra cứu đơn SF-…" và trạng thái đúng.
4. Hỏi "Viết giúp tôi bài thơ" → từ chối lịch sự.
5. Hỏi "Huỷ đơn này giúp khách" → xuất hiện **đề xuất** chờ duyệt (đơn chưa bị huỷ) → bấm **Duyệt và huỷ đơn** → cửa sổ của khách thấy trạng thái "Đã huỷ" ngay (realtime).
6. Nhắc tới `audit_logs`: ai duyệt, lúc nào, trạng thái trước/sau.
