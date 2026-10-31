#!/usr/bin/env bash
# Daily PostgreSQL backup to S3 (cron 02:00, see bootstrap-ec2.sh).
# The instance role may PutObject into the bucket but not delete: a compromised host cannot wipe backups.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPTS/lib.sh"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/var/backups/shopfast
mkdir -p "$WORK"
DUMP="$WORK/shopfast-$STAMP.dump"
COUNTS="$WORK/shopfast-$STAMP.counts"

psql_exec() { docker exec shopfast-postgres psql -U postgres -d shopfast -At -c "$1"; }

log "Dumping database"
docker exec shopfast-postgres pg_dump -U postgres -Fc shopfast > "$DUMP"
[ -s "$DUMP" ] || die "empty dump"

# Exact row counts, compared during the restore drill.
for table in $(psql_exec "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"); do
  printf '%s %s\n' "$table" "$(psql_exec "SELECT count(*) FROM \"$table\"")"
done > "$COUNTS"

log "Uploading $(du -h "$DUMP" | cut -f1) to s3://$BACKUP_BUCKET/daily/"
aws s3 cp --only-show-errors --sse aws:kms "$DUMP" "s3://$BACKUP_BUCKET/daily/$(basename "$DUMP")"
aws s3 cp --only-show-errors --sse aws:kms "$COUNTS" "s3://$BACKUP_BUCKET/daily/$(basename "$COUNTS")"

aws cloudwatch put-metric-data --region "$AWS_REGION" --namespace ShopFast \
  --metric-name BackupSucceeded --value 1 || log "WARNING: could not publish metric"

find "$WORK" -type f -mtime +3 -delete
log "Backup $STAMP done"
