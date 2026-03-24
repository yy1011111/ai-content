#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/backup.dump"
  exit 1
fi

DUMP_FILE="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${DB_NAME:-ai_content}"
DB_USER="${DB_USER:-postgres}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Backup file not found: $DUMP_FILE"
  exit 1
fi

echo "[restore-db] restoring $DUMP_FILE into $DB_NAME"
cat "$DUMP_FILE" | docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres sh -lc \
  "dropdb -U '$DB_USER' --if-exists '$DB_NAME' && createdb -U '$DB_USER' '$DB_NAME' && pg_restore -U '$DB_USER' -d '$DB_NAME' --clean --if-exists"

echo "[restore-db] done"
