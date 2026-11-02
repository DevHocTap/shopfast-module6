# Runbook — Vận hành & bàn giao (Giai đoạn 6, F07)

Danh sách việc cần làm **một lần trên AWS / GitHub** (không tự động hoá được từ repo vì cần quyền quản trị hoặc thao tác của chủ tài khoản), kèm cách lưu bằng chứng cho buổi bảo vệ.

| # | Việc | Bằng chứng lưu ở |
|---|------|------------------|
| 1 | Cảnh báo CloudWatch + email | Ảnh chụp danh sách alarm, email "ALARM" thử nghiệm |
| 2 | Giám sát uptime bên ngoài | Lịch sử workflow **Uptime** trên Actions |
| 3 | Diễn tập khôi phục từ S3 | `docs/runbooks/restore-drill-<ngày>.md` |
| 4 | PR có test hỏng bị chặn merge | Link PR + ảnh chụp "Merging is blocked" |
| 5 | Tự quay lui khi health check hỏng | Link lần chạy Deploy có job **Roll back** |

---

## 1. Cảnh báo CloudWatch

Chạy từ **AWS CloudShell** (vùng Sydney), không chạy bằng instance role của EC2:

```bash
git clone https://github.com/DevHocTap/shopfast-module6.git && cd shopfast-module6
INSTANCE_ID=<i-...> ALERT_EMAIL=<email nhận cảnh báo> bash infra/aws/alarms.sh
```

- Bấm link xác nhận trong email "AWS Notification - Subscription Confirmation".
- Thử đường gửi email:
  `aws --region ap-southeast-2 cloudwatch set-alarm-state --alarm-name shopfast-cpu-high --state-value ALARM --state-reason "thu nghiem"`
  → phải nhận email trong ~1 phút; alarm tự về `OK` ở lần đánh giá kế tiếp.
- `shopfast-backup-missing` ở trạng thái `INSUFFICIENT_DATA`/`ALARM` cho tới bản sao lưu đầu tiên sau khi tạo — bình thường. Chạy tay `sudo /opt/shopfast/current/scripts/backup.sh` để thấy nó về `OK`.

| Alarm | Khi nào kêu | Phản ứng |
|-------|-------------|----------|
| `shopfast-ec2-system-check` | Phần cứng/mạng của AWS lỗi | Tự **recover** sang máy vật lý khác (giữ IP, ổ đĩa) |
| `shopfast-ec2-instance-check` | Hệ điều hành không phản hồi | Xem console → reboot |
| `shopfast-cpu-high` | CPU > 85 % trong 15 phút | Kiểm tra k6 đang chạy? `docker stats` |
| `shopfast-backup-missing` | 26 giờ không có bản sao lưu | `tail /var/log/shopfast-backup.log`, chạy tay `backup.sh` |

## 2. Giám sát uptime bên ngoài

Workflow [`.github/workflows/uptime.yml`](../../.github/workflows/uptime.yml) chạy 10 phút một lần **từ mạng của GitHub**, nên vẫn phát hiện được khi cả EC2 sập (điều CloudWatch trong máy không làm được). Nó kiểm tra:
- `GET /api/health/ready` trả 200 (thử lại 3 lần cách 20 s để không báo nhầm lúc chuyển blue/green); `degraded` (Redis chết) chỉ cảnh báo vàng.
- Trang chủ trả 200 và chứng chỉ TLS còn ≥ 14 ngày (certbot gia hạn ở mốc 30 ngày).

Lịch chạy chỉ có hiệu lực **sau khi file nằm trên `main`**. Lần chạy lỗi → GitHub gửi email cho người sửa cron gần nhất (Settings → Notifications → Actions phải bật). Chạy tay: Actions → Uptime → Run workflow.

> Vì sao không dùng Route 53 health check: metric của nó nằm ở `us-east-1`, vùng bị SCP của lớp chặn (ADR-12).

## 3. Diễn tập khôi phục (mục tiêu < 30 phút, RPO 24 h)

Trên EC2, không đụng tới DB production (`restore.sh` dựng container PostgreSQL tạm):

```bash
sudo /opt/shopfast/current/scripts/backup.sh          # tạo bản mới nhất (hoặc dùng bản đêm qua)
time sudo /opt/shopfast/current/scripts/restore.sh    # tải từ S3, pg_restore, so số dòng từng bảng
```

Kết quả mong đợi: mọi bảng `OK`, dòng cuối `Restore drill finished in <N>s, 0 table(s) mismatched`. Sau đó tạo file biên bản `docs/runbooks/restore-drill-<YYYY-MM-DD>.md` theo mẫu dưới và mở PR.

```markdown
# Biên bản diễn tập khôi phục — <YYYY-MM-DD>

- Người thực hiện: <tên>
- Bản sao lưu: s3://<bucket>/daily/shopfast-<stamp>.dump (<kích thước>)
- Bắt đầu / kết thúc: <hh:mm> / <hh:mm> — **tổng <N> giây** (mục tiêu < 30 phút)
- Kết quả so khớp: <số bảng> bảng, 0 lệch (dán phần log `OK …`)
- Vấn đề gặp phải và cách xử lý: <không có / …>
- Khôi phục thật lên production sẽ làm thế nào: dừng api + worker, `pg_restore --clean` vào
  `shopfast-postgres` từ cùng file, chạy migration, khởi động lại, kiểm tra `/api/health/ready`.
```

## 4. PR có test hỏng bị chặn merge

```bash
git checkout -b demo/failing-test main
# Sửa một kỳ vọng cho sai, ví dụ trong apps/api/src/modules/orders/order-state-machine.spec.ts
git commit -am "test: intentionally failing test (demo, do not merge)"
git push -u origin demo/failing-test
```

Mở PR vào `main` → job **Unit tests + coverage gate** đỏ → nút merge hiển thị *Merging is blocked* (6 check bắt buộc). Chụp màn hình, ghi link PR vào [07](../07-technical-decisions.md) hoặc slide, rồi **đóng PR, không merge** và xoá nhánh.

## 5. Bằng chứng tự quay lui

Nếu chưa có sẵn lần chạy nào: tạo nhánh làm hỏng `/api/health/ready` (ví dụ trả 503 cố định), merge qua PR trong khung giờ demo → Deploy chạy, smoke test thất bại, job **Roll back** đưa bản cũ lên lại. Lưu link lần chạy; revert ngay bằng PR tiếp theo. (Cách an toàn hơn: chạy *Deploy → Run workflow* với SHA của một commit hỏng trên nhánh riêng.)

## 6. Trước buổi bảo vệ

- [ ] `curl -s https://shopfast.hmicodev.io.vn/api/health/ready` → `ok`.
- [ ] Tất cả alarm ở trạng thái `OK`; lịch sử Uptime xanh 24 h gần nhất.
- [ ] Có biên bản diễn tập khôi phục, link PR bị chặn, link lần tự quay lui.
- [ ] Đổi mật khẩu tài khoản demo hoặc xoá `/shopfast/prod/SEED_DEMO_PASSWORD` (xem [seed-production](seed-production.md)).
- [ ] Nếu dùng trợ lý AI khi demo: đã đặt `ANTHROPIC_API_KEY` và chạy bộ đánh giá ([ai-assistant](ai-assistant.md)).
- [ ] Ghi hình trước một lượt demo đầy đủ làm phương án dự phòng.
