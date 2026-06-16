#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-backups/postgres}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/postgres-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$OUT"

sha256sum "$OUT" > "$OUT.sha256"
echo "backup=$OUT"
echo "checksum=$OUT.sha256"
