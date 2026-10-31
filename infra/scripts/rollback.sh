#!/usr/bin/env bash
# Return traffic to the previously active version.
#   - Previous color still running and healthy → one Nginx reload (seconds).
#   - Otherwise → full redeploy of the previous commit from its kept release bundle (~1–2 min).
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPTS/lib.sh"

ACTIVE=$(read_state active_color)
ACTIVE_SHA=$(read_state active_sha)
PREV=$(read_state previous_color)
PREV_SHA=$(read_state previous_sha)
[ "$PREV" != none ] && [ "$PREV_SHA" != none ] || die "no previous version recorded, nothing to roll back to"

log "=== Rolling back $ACTIVE ($ACTIVE_SHA) → $PREV ($PREV_SHA)"
START=$(date +%s)

running_tag=$(docker inspect -f '{{.Config.Image}}' "shopfast-api-$PREV" 2>/dev/null | sed 's/.*://' || true)
if [ "$running_tag" = "$PREV_SHA" ] && wait_healthy "shopfast-api-$PREV" 10; then
  export COMPOSE_FILE_OVERRIDE="$ROOT/releases/$PREV_SHA/compose/docker-compose.prod.yml"
  [ -f "$COMPOSE_FILE_OVERRIDE" ] || export COMPOSE_FILE_OVERRIDE="$ROOT/current/compose/docker-compose.prod.yml"

  publish_web "$PREV_SHA"
  switch_upstream "$PREV"
  write_state previous_color "$ACTIVE"
  write_state previous_sha "$ACTIVE_SHA"
  write_state active_color "$PREV"
  write_state active_sha "$PREV_SHA"
  [ -d "$ROOT/releases/$PREV_SHA" ] && ln -sfn "$ROOT/releases/$PREV_SHA" "$ROOT/current"

  set_env_var WORKER_TAG "$PREV_SHA"
  compose up -d --no-deps worker
  log "=== Rolled back by switching upstream in $(($(date +%s) - START))s"
else
  log "Previous color not available, redeploying $PREV_SHA"
  [ -x "$ROOT/releases/$PREV_SHA/scripts/deploy.sh" ] || die "release bundle for $PREV_SHA was cleaned up"
  "$ROOT/releases/$PREV_SHA/scripts/deploy.sh" "$PREV_SHA"
  log "=== Rolled back by redeploy in $(($(date +%s) - START))s"
fi
