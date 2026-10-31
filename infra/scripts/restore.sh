#!/usr/bin/env bash
# Restore drill: restore a backup from S3 into a throw-away PostgreSQL container,
# compare exact row counts with the ones captured at backup time and report the duration.
# Production is never touched by this script.
#
#   restore.sh                 → latest backup
#   restore.sh <dump-file-name> → a specific backup, e.g. shopfast-20261101T020000Z.dump
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPTS/lib.sh"

CONTAINER=shopfast-restore-drill
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; docker rm -f "$CONTAINER" > /dev/null 2>&1 || true' EXIT
START=$(date +%s)

NAME="${1:-$(aws s3 ls "s3://$BACKUP_BUCKET/daily/" | awk '{print $4}' | grep '\.dump$' | sort | tail -1)}"
[ -n "$NAME" ] || die "no backup found in s3://$BACKUP_BUCKET/daily/"
log "Restoring $NAME"

aws s3 cp --only-show-errors "s3://$BACKUP_BUCKET/daily/$NAME" "$WORK/backup.dump"
aws s3 cp --only-show-errors "s3://$BACKUP_BUCKET/daily/${NAME%.dump}.counts" "$WORK/expected.counts"

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=shopfast postgres:16-alpine > /dev/null
until docker exec "$CONTAINER" pg_isready -U postgres -d shopfast > /dev/null 2>&1; do sleep 1; done
docker exec "$CONTAINER" psql -U postgres -c "CREATE ROLE shopfast" > /dev/null

docker cp "$WORK/backup.dump" "$CONTAINER:/tmp/backup.dump"
docker exec "$CONTAINER" pg_restore -U postgres -d shopfast --no-owner --exit-on-error /tmp/backup.dump

psql_drill() { docker exec "$CONTAINER" psql -U postgres -d shopfast -At -c "$1"; }
mismatches=0
while read -r table expected; do
  actual=$(psql_drill "SELECT count(*) FROM \"$table\"")
  if [ "$actual" = "$expected" ]; then
    log "  OK   $table: $actual rows"
  else
    log "  DIFF $table: expected $expected, got $actual"
    mismatches=$((mismatches + 1))
  fi
done < "$WORK/expected.counts"

DURATION=$(($(date +%s) - START))
log "=== Restore drill finished in ${DURATION}s, $mismatches table(s) mismatched"
log "Record the result in docs/runbooks/restore-drill-$(date -u +%F).md"
[ "$mismatches" -eq 0 ]
