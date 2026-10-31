#!/usr/bin/env bash
# One-time preparation of a fresh Amazon Linux 2023 instance. Run as root (SSM Session Manager):
#
#   sudo DOMAIN=shopfast.hmicodev.io.vn ADMIN_EMAIL=you@example.com AWS_REGION=ap-southeast-2 \
#        IMAGE_REGISTRY=ghcr.io/devhoctap/shopfast-module6 \
#        BACKUP_BUCKET=shopfast-backups-464986173621 \
#        bash bootstrap-ec2.sh
#
# Afterwards: init-letsencrypt.sh (TLS), setup-runner.sh (GitHub runner), then the first deploy.
set -euo pipefail

: "${DOMAIN:?}" "${ADMIN_EMAIL:?}" "${AWS_REGION:?}" "${IMAGE_REGISTRY:?}" "${BACKUP_BUCKET:?}"
SSM_PREFIX="${SSM_PREFIX:-/shopfast/prod}"
COMPOSE_VERSION="${COMPOSE_VERSION:-v2.32.1}"

echo "Installing Docker, Compose, cron, runner dependencies"
dnf install -y docker cronie jq git libicu tar
systemctl enable --now docker crond
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

if [ ! -f /swapfile ]; then
  echo "Adding 2G swap (headroom while blue and green run side by side)"
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "Creating /opt/shopfast"
mkdir -p /opt/shopfast/{releases,shared/state} /var/backups/shopfast /var/www/certbot /etc/letsencrypt
cat > /opt/shopfast/host.env <<EOF
DOMAIN=$DOMAIN
ADMIN_EMAIL=$ADMIN_EMAIL
AWS_REGION=$AWS_REGION
IMAGE_REGISTRY=$IMAGE_REGISTRY
BACKUP_BUCKET=$BACKUP_BUCKET
SSM_PREFIX=$SSM_PREFIX
EOF
chmod 644 /opt/shopfast/host.env

echo "Installing cron jobs"
cat > /etc/cron.d/shopfast <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
0 2 * * * root /opt/shopfast/current/scripts/backup.sh >> /var/log/shopfast-backup.log 2>&1
17 3 * * * root /opt/shopfast/current/scripts/renew-cert.sh >> /var/log/shopfast-certbot.log 2>&1
EOF

echo "Done. Next: init-letsencrypt.sh, setup-runner.sh, then the first deploy."
