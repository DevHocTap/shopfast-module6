#!/usr/bin/env bash
# Render runtime secrets from SSM Parameter Store (SecureString) using the EC2 instance role.
# Nothing secret lives in the repository, the images or the pipeline.
#
#   $SSM_PREFIX/DB_PASSWORD        application database password
#   $SSM_PREFIX/POSTGRES_PASSWORD  cluster superuser (backups / maintenance only)
#   $SSM_PREFIX/REDIS_PASSWORD
#   $SSM_PREFIX/<ANY_OTHER_KEY>    passed to api + worker as-is (JWT secrets, LLM key… in later phases)
#
# Output (chmod 600):
#   shared/.env            → api, worker      (everything except POSTGRES_PASSWORD)
#   shared/datastore.env   → postgres, redis  (only what they need)
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPTS/lib.sh"

umask 077
mkdir -p "$SHARED"
all=$(mktemp)
trap 'rm -f "$all" "$all.app" "$all.ds"' EXIT

aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$SSM_PREFIX/" --recursive \
  --with-decryption --query 'Parameters[*].[Name,Value]' --output text |
  while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > "$all"

value_of() { grep -m1 "^$1=" "$all" | cut -d= -f2- || true; }
for required in DB_PASSWORD POSTGRES_PASSWORD REDIS_PASSWORD; do
  [ -n "$(value_of "$required")" ] || die "missing SSM parameter $SSM_PREFIX/$required"
done

grep -v '^POSTGRES_PASSWORD=' "$all" > "$all.app"
{
  echo "POSTGRES_PASSWORD=$(value_of POSTGRES_PASSWORD)"
  echo "APP_DB_PASSWORD=$(value_of DB_PASSWORD)"
  echo "REDIS_PASSWORD=$(value_of REDIS_PASSWORD)"
} > "$all.ds"

mv "$all.app" "$SHARED/.env"
mv "$all.ds" "$SHARED/datastore.env"
log "Rendered $(wc -l < "$SHARED/.env") app variables from $SSM_PREFIX"
