#!/usr/bin/env sh
set -eu

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nested-api-relay}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
RUN_BACKUP_BEFORE_DEPLOY="${RUN_BACKUP_BEFORE_DEPLOY:-true}"
RUN_SMOKE="${RUN_SMOKE:-auto}"
RUN_RESTART_VERIFY="${RUN_RESTART_VERIFY:-false}"
PRECHECK_ONLY="${PRECHECK_ONLY:-false}"

compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

require_file() {
  if [ ! -f "$1" ]; then
    echo "required file missing: $1"
    exit 2
  fi
}

wait_api_health() {
  attempt=1
  while [ "$attempt" -le 60 ]; do
    if compose exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo "api_health=ok"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done

  echo "api_health=failed"
  compose logs --tail=120 api
  exit 1
}

run_smoke_if_configured() {
  case "$RUN_SMOKE" in
    false)
      echo "smoke=skipped RUN_SMOKE=false"
      return 0
      ;;
    true)
      if [ -z "${SMOKE_API_URL:-}" ] || [ -z "${SMOKE_WEB_URL:-}" ]; then
        echo "SMOKE_API_URL and SMOKE_WEB_URL are required when RUN_SMOKE=true"
        exit 2
      fi
      npm run smoke:t21:deploy
      ;;
    auto)
      if [ -n "${SMOKE_API_URL:-}" ] && [ -n "${SMOKE_WEB_URL:-}" ]; then
        npm run smoke:t21:deploy
      else
        echo "smoke=skipped set SMOKE_API_URL and SMOKE_WEB_URL, or RUN_SMOKE=true to require it"
      fi
      ;;
    *)
      echo "RUN_SMOKE must be auto, true, or false"
      exit 2
      ;;
  esac
}

require_file "$COMPOSE_FILE"
require_file "$ENV_FILE"

node ops/deploy/preflight.mjs --env-file "$ENV_FILE"

if [ "$PRECHECK_ONLY" = "true" ]; then
  echo "precheck_only=done"
  exit 0
fi

compose config >/tmp/nested-api-relay-compose.prod.yml

if [ "$RUN_BACKUP_BEFORE_DEPLOY" = "true" ] && compose ps --status running --services | grep -qx 'postgres'; then
  COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup/postgres-backup.sh
else
  echo "backup=skipped postgres is not running yet or RUN_BACKUP_BEFORE_DEPLOY=false"
fi

compose up -d --build --remove-orphans
wait_api_health
compose exec -T api npm --prefix apps/api run db:migrate
wait_api_health
compose ps
run_smoke_if_configured

if [ "$RUN_RESTART_VERIFY" = "true" ]; then
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    ENV_FILE="$ENV_FILE" \
    RUN_SMOKE="$RUN_SMOKE" \
    sh ops/deploy/restart-verify.sh
fi

echo "deploy=ok"
