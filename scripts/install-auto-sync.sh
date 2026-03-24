#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_LOG_DIR="${SYNC_LOG_DIR:-$ROOT_DIR/logs}"
SYNC_LOG_FILE="$SYNC_LOG_DIR/auto-sync.log"
SYNC_MINUTES="${SYNC_MINUTES:-5}"
CRON_TAG="# ai-content-auto-sync"
CRON_LINE="*/${SYNC_MINUTES} * * * * REPO_SLUG='yy1011111/ai-content' BRANCH='codex/strategy-source-binding-wip' /bin/bash '$ROOT_DIR/scripts/server-sync.sh' >> '$SYNC_LOG_FILE' 2>&1 $CRON_TAG"

mkdir -p "$SYNC_LOG_DIR"

CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
FILTERED_CRON="$(printf '%s\n' "$CURRENT_CRON" | grep -v "$CRON_TAG" || true)"

{
  printf '%s\n' "$FILTERED_CRON"
  printf '%s\n' "$CRON_LINE"
} | crontab -

echo "[install-auto-sync] installed: $CRON_LINE"
echo "[install-auto-sync] log file: $SYNC_LOG_FILE"
