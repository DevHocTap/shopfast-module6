# Dựng hạ tầng AWS (làm một lần)

Thay `<ACCOUNT_ID>`, `<REGION>` (**`ap-southeast-2` — Sydney**: tài khoản lớp học bị SCP của Organization giới hạn chỉ dùng region này), `<GITHUB_OWNER>/<REPO_NAME>`, tên miền trong các bước dưới.
Mọi thao tác làm bằng IAM user trong group `Admins` **có MFA** — không dùng root.

## 1. Tài khoản & con người (chuẩn Session 07)
- [ ] Root: bật MFA, xoá mọi access key của root.
- [ ] Tạo group `Admins` (AdministratorAccess) và `Developers` (quyền đọc + ECR/SSM nếu cần); user thuộc group, **bắt buộc MFA**.
- [ ] Bật AWS Budget cảnh báo chi phí (ví dụ 20 USD/tháng).

## 2. Lưu trữ
- [ ] ECR: tạo repo `shopfast/api` và `shopfast/web`, bật **tag immutability** và scan on push.
  Lifecycle: giữ 30 image gần nhất.
- [ ] S3 `shopfast-artifacts-<ACCOUNT_ID>`: chặn public access; lifecycle xoá `releases/` sau 30 ngày.
- [ ] S3 `shopfast-backups-<ACCOUNT_ID>`: chặn public access, **bật versioning**, mã hoá SSE-KMS mặc định,
  lifecycle `daily/` → Glacier sau 30 ngày, xoá sau 90 ngày.

## 3. Secrets — SSM Parameter Store (SecureString)
Sinh giá trị bằng `openssl rand -hex 32` (chỉ chữ + số, tránh ký tự đặc biệt làm hỏng file env):

| Tên | Ghi chú |
|-----|---------|
| `/shopfast/prod/DB_PASSWORD` | mật khẩu user ứng dụng `shopfast` |
| `/shopfast/prod/POSTGRES_PASSWORD` | superuser — chỉ dùng cho sao lưu/bảo trì |
| `/shopfast/prod/REDIS_PASSWORD` | |
| `/shopfast/prod/SWAGGER_ENABLED` | kiểu String, `true` (môi trường demo) |

> Các mật khẩu DB/Redis chỉ được áp dụng **lúc khởi tạo volume lần đầu**. Đổi sau đó phải đổi cả trong PostgreSQL/Redis.

## 4. IAM role
- [ ] **Instance role** `shopfast-ec2`: policy [ec2-instance-policy.json](iam/ec2-instance-policy.json) + managed policy `AmazonSSMManagedInstanceCore`.
- [ ] **OIDC provider** `token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
- [ ] **Deploy role** `shopfast-gha-deploy`: trust policy [gha-deploy-trust-policy.json](iam/gha-deploy-trust-policy.json)
  (chỉ job chạy trong GitHub environment `production` của đúng repo được assume),
  permission policy [gha-deploy-policy.json](iam/gha-deploy-policy.json). Max session 1 giờ.

## 5. Mạng & máy chủ
- [ ] Security group `shopfast-web`: inbound `80`, `443` từ `0.0.0.0/0` (và `::/0`); `22` **chỉ** từ `<IP quản trị>/32`. Không mở 3000/5432/6379.
- [ ] EC2 **t3.medium**, Amazon Linux 2023, EBS gp3 30 GB (mã hoá), instance role `shopfast-ec2`,
  **IMDSv2 bắt buộc** (`HttpTokens=required`), tag `app=shopfast`.
- [ ] Elastic IP gắn vào instance; bản ghi DNS `A <domain> → Elastic IP`.

## 6. Chuẩn bị máy chủ (SSM Session Manager hoặc SSH từ IP quản trị)
```bash
# copy infra/scripts/bootstrap-ec2.sh và init-letsencrypt.sh lên máy, rồi:
sudo DOMAIN=<domain> ADMIN_EMAIL=<email> AWS_REGION=<REGION> \
     ECR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com \
     ARTIFACTS_BUCKET=shopfast-artifacts-<ACCOUNT_ID> BACKUP_BUCKET=shopfast-backups-<ACCOUNT_ID> \
     bash bootstrap-ec2.sh
sudo bash init-letsencrypt.sh   # cần DNS đã trỏ đúng
```

## 7. GitHub
- [ ] Settings → Environments → tạo `production` (tuỳ chọn: required reviewer để duyệt trước khi deploy).
- [ ] Settings → Variables (Actions) — **không phải secrets, vì không có gì bí mật**:
  `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECR_REGISTRY`, `EC2_INSTANCE_ID`, `ARTIFACTS_BUCKET`, `APP_DOMAIN`.
- [ ] Branch protection cho `main`: bắt buộc PR, bắt buộc các check `Lint, format, typecheck`, `Unit tests + coverage gate`,
  `Integration tests (PostgreSQL 16 + Redis 7)`, `Secret scan (gitleaks)`, `Docker build (no push) (api)`, `Docker build (no push) (web)`;
  chặn force push.

## 8. Lần triển khai đầu tiên
Merge một PR vào `main` (hoặc Actions → Deploy → Run workflow). Kiểm tra:
```bash
curl -s https://<domain>/api/health/ready   # {"status":"ok",...}
curl -sI http://<domain>/ | head -1         # 301 → https
```

## 9. Giám sát tối thiểu
- [ ] CloudWatch alarm `StatusCheckFailed` của EC2 → SNS email.
- [ ] CloudWatch alarm metric `ShopFast/BackupSucceeded` < 1 trong 26 giờ (treat missing data as breaching).
- [ ] UptimeRobot (hoặc Route 53 health check) gọi `https://<domain>/api/health/ready` mỗi phút.
