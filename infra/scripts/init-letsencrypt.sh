#!/usr/bin/env bash
# Obtain the first TLS certificate, before Nginx is running (certbot listens on :80 itself).
# Prerequisite: the domain's A record points at the instance's Elastic IP.
set -euo pipefail
# shellcheck source=/dev/null
source /opt/shopfast/host.env

docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  certbot/certbot certonly --standalone -d "$DOMAIN" -m "$ADMIN_EMAIL" --agree-tos -n
