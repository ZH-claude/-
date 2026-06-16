#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "usage: ops/deploy/rollback.sh <git-ref>"
  exit 2
fi

TARGET_REF="$1"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
SKIP_ROLLBACK_BACKUP="${SKIP_ROLLBACK_BACKUP:-false}"

if [ "$SKIP_ROLLBACK_BACKUP" != "true" ]; then
  COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup/postgres-backup.sh
fi

git fetch origin --tags
git checkout "$TARGET_REF"

docker compose -f "$COMPOSE_FILE" build api web
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
docker compose -f "$COMPOSE_FILE" exec -T api npm --prefix apps/api run db:migrate

if [ -n "${SMOKE_API_URL:-}" ] && [ -n "${SMOKE_WEB_URL:-}" ]; then
  node ops/smoke/t21-deploy-smoke.mjs
else
  echo "SMOKE_API_URL and SMOKE_WEB_URL are not set; run ops/smoke/t21-deploy-smoke.mjs manually after rollback."
fi
