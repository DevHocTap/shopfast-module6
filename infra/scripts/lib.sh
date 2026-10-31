#!/usr/bin/env bash
# Shared helpers for the scripts that run on the EC2 host. Source, do not execute.
#
# Host layout:
#   /opt/shopfast/host.env            non-secret host settings (written by bootstrap-ec2.sh)
#   /opt/shopfast/releases/<sha>/     infra bundle of each deployed commit (compose, nginx, scripts)
#   /opt/shopfast/current             -> releases/<sha> currently serving
#   /opt/shopfast/shared/             state that survives releases:
#       .env, datastore.env           secrets rendered from SSM (chmod 600)
#       deploy.env                    image tags for compose interpolation
#       state/                        active_color, active_sha, previous_color, previous_sha
#       nginx/, web/, postgres-init/  files mounted into containers

set -euo pipefail

ROOT=/opt/shopfast
SHARED="$ROOT/shared"
STATE_DIR="$SHARED/state"
DEPLOY_ENV="$SHARED/deploy.env"

# shellcheck source=/dev/null
source "$ROOT/host.env" # AWS_REGION, IMAGE_REGISTRY, DOMAIN, BACKUP_BUCKET, SSM_PREFIX, ADMIN_EMAIL

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

compose() {
  local file="${COMPOSE_FILE_OVERRIDE:-$ROOT/current/compose/docker-compose.prod.yml}"
  docker compose -p shopfast --env-file "$DEPLOY_ENV" -f "$file" "$@"
}

read_state() { cat "$STATE_DIR/$1" 2>/dev/null || echo none; }
write_state() { mkdir -p "$STATE_DIR"; printf '%s\n' "$2" > "$STATE_DIR/$1"; }

# set_env_var KEY VALUE — upsert a line in deploy.env
set_env_var() {
  if grep -q "^$1=" "$DEPLOY_ENV" 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" "$DEPLOY_ENV"
  else
    printf '%s=%s\n' "$1" "$2" >> "$DEPLOY_ENV"
  fi
}

other_color() { [ "$1" = blue ] && echo green || echo blue; }

# wait_healthy CONTAINER TIMEOUT_SECONDS — relies on the container HEALTHCHECK
wait_healthy() {
  local container="$1" timeout="$2" elapsed=0 status
  while [ "$elapsed" -lt "$timeout" ]; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)
    case "$status" in
      healthy) log "$container is healthy (${elapsed}s)"; return 0 ;;
      unhealthy | exited | dead | missing) log "$container is $status"; return 1 ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log "$container not healthy after ${timeout}s"
  return 1
}

# switch_upstream COLOR — point Nginx at api-COLOR without dropping connections
switch_upstream() {
  local color="$1" conf="$SHARED/nginx/upstream.d/active.conf" backup
  backup=$(cat "$conf" 2>/dev/null || true)
  printf 'server api-%s:3000;\n' "$color" > "$conf"

  if [ -z "$(docker ps -q -f name=^shopfast-nginx$)" ]; then
    compose up -d --no-deps nginx
    return 0
  fi
  if docker exec shopfast-nginx nginx -t -q; then
    docker exec shopfast-nginx nginx -s reload
    log "Traffic switched to api-$color"
  else
    printf '%s\n' "$backup" > "$conf"
    die "nginx config test failed, upstream restored"
  fi
}

# publish_web SHA — copy the static build out of the web image, switch the symlink atomically
publish_web() {
  local sha="$1" dir="$SHARED/web/releases/$1" cid
  if [ ! -d "$dir" ]; then
    cid=$(docker create "$IMAGE_REGISTRY/web:$sha")
    mkdir -p "$dir"
    docker cp "$cid:/usr/share/nginx/html/." "$dir/"
    docker rm "$cid" > /dev/null
  fi
  ln -sfn "releases/$sha" "$SHARED/web/current.tmp"
  mv -Tf "$SHARED/web/current.tmp" "$SHARED/web/current"
}

# keep_latest DIR N — delete all but the N most recently modified entries
keep_latest() {
  local dir="$1" keep="$2"
  [ -d "$dir" ] || return 0
  ls -1t "$dir" | tail -n +"$((keep + 1))" | while read -r old; do rm -rf "${dir:?}/$old"; done
}
