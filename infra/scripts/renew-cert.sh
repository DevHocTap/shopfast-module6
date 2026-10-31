#!/usr/bin/env bash
# Daily (cron): renew the certificate through the ACME webroot served by Nginx, then reload Nginx.
set -euo pipefail

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet

docker exec shopfast-nginx nginx -s reload
