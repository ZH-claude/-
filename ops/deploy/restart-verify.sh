#!/usr/bin/env sh
set -eu

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nested-api-relay}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
RUN_SMOKE="${RUN_SMOKE:-auto}"

compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
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

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "required file missing: $COMPOSE_FILE"
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "required file missing: $ENV_FILE"
  exit 2
fi

compose restart postgres redis api web caddy
wait_api_health
compose ps
run_smoke_if_configured
echo "restart_verify=ok"
