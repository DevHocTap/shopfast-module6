#!/usr/bin/env bash
# Blue/green deploy of one commit. Invoked by the GitHub Actions self-hosted runner on this host,
#   after it copied infra/ to /opt/shopfast/releases/<sha> and logged in to GHCR:
#   /opt/shopfast/releases/<sha>/scripts/deploy.sh <sha>
#
# Order matters — every step before "switch traffic" can fail without users noticing:
#   secrets → pull → data stores → migrations → start idle color → health → web → switch → worker
set -euo pipefail

SHA="${1:?usage: deploy.sh <git-sha>}"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPTS/lib.sh"

RELEASE="$ROOT/releases/$SHA"
[ -d "$RELEASE" ] || die "release bundle $RELEASE not found"
export COMPOSE_FILE_OVERRIDE="$RELEASE/compose/docker-compose.prod.yml"
START=$(date +%s)

log "=== Deploying $SHA"
"$SCRIPTS/render-env.sh"
docker pull -q "$IMAGE_REGISTRY/api:$SHA"
docker pull -q "$IMAGE_REGISTRY/web:$SHA"

log "Installing shared config"
mkdir -p "$SHARED"/{nginx/conf.d,nginx/upstream.d,web/releases,postgres-init}
cp "$RELEASE/nginx/nginx.conf" "$SHARED/nginx/nginx.conf"
cp "$RELEASE/nginx/security-headers.inc" "$SHARED/nginx/conf.d/security-headers.inc"
sed "s/__DOMAIN__/$DOMAIN/g" "$RELEASE/nginx/shopfast.conf.template" > "$SHARED/nginx/conf.d/shopfast.conf"
cp "$RELEASE"/postgres/init/* "$SHARED/postgres-init/"

if [ ! -f "$DEPLOY_ENV" ]; then
  log "First deploy: initialising $DEPLOY_ENV"
  {
    echo "IMAGE_REGISTRY=$IMAGE_REGISTRY"
    echo "SHARED_DIR=$SHARED"
    echo "API_BLUE_TAG=$SHA"
    echo "API_GREEN_TAG=$SHA"
    echo "WORKER_TAG=$SHA"
  } > "$DEPLOY_ENV"
fi

log "Starting data stores (never recreated by a deploy)"
compose up -d --no-recreate postgres redis
wait_healthy shopfast-postgres 120 || die "postgres not healthy"
wait_healthy shopfast-redis 60 || die "redis not healthy"

log "Running migrations"
docker run --rm --network shopfast_backend --env-file "$SHARED/.env" \
  -e DB_HOST=postgres -e DB_USER=shopfast -e DB_NAME=shopfast -e REDIS_HOST=redis \
  "$IMAGE_REGISTRY/api:$SHA" node dist/infra/database/migrate.js

ACTIVE=$(read_state active_color)
ACTIVE_SHA=$(read_state active_sha)
TARGET=$(other_color "$ACTIVE")
log "Active: $ACTIVE ($ACTIVE_SHA) → target: $TARGET"

set_env_var "API_${TARGET^^}_TAG" "$SHA"
compose up -d --no-deps "api-$TARGET"
if ! wait_healthy "shopfast-api-$TARGET" 90; then
  docker logs --tail 50 "shopfast-api-$TARGET" || true
  compose stop "api-$TARGET"
  die "new version is unhealthy — traffic was NOT switched, $ACTIVE keeps serving"
fi

publish_web "$SHA"
switch_upstream "$TARGET"

write_state previous_color "$ACTIVE"
write_state previous_sha "$ACTIVE_SHA"
write_state active_color "$TARGET"
write_state active_sha "$SHA"
ln -sfn "$RELEASE" "$ROOT/current"

# The previous color keeps running (idle) until the next deploy: rollback is a single Nginx reload.
# Its open WebSocket connections drain on their own (worker_shutdown_timeout).

log "Restarting worker on $SHA (active jobs finish first: stop_grace_period)"
set_env_var WORKER_TAG "$SHA"
compose up -d --no-deps worker
wait_healthy shopfast-worker 60 || log "WARNING: worker not healthy yet, check 'docker logs shopfast-worker'"

keep_latest "$ROOT/releases" 5
keep_latest "$SHARED/web/releases" 5
docker image prune -af --filter "until=168h" > /dev/null || true

log "=== Deployed $SHA on $TARGET in $(($(date +%s) - START))s"
