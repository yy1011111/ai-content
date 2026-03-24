#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
SCHEDULE_MINUTE="${SCHEDULE_MINUTE:-30}"
SCHEDULE_HOUR="${SCHEDULE_HOUR:-3}"
LOG_FILE="$BACKUP_DIR/backup.log"
CRON_TAG="# ai-content-db-backup"
CRON_LINE="$SCHEDULE_MINUTE $SCHEDULE_HOUR * * * BACKUP_DIR='$BACKUP_DIR' RETENTION_DAYS='$RETENTION_DAYS' /bin/bash '$ROOT_DIR/scripts/backup-db.sh' >> '$LOG_FILE' 2>&1 $CRON_TAG"

mkdir -p "$BACKUP_DIR"

CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
FILTERED_CRON="$(printf '%s\n' "$CURRENT_CRON" | grep -v "$CRON_TAG" || true)"

{
  printf '%s\n' "$FILTERED_CRON"
  printf '%s\n' "$CRON_LINE"
} | crontab -

echo "[install-backup-cron] installed: $CRON_LINE"
