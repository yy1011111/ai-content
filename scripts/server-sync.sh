#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_SLUG="${REPO_SLUG:-yy1011111/ai-content}"
BRANCH="${BRANCH:-codex/strategy-source-binding-wip}"
ENCODED_BRANCH="${BRANCH//\//%2F}"
STATE_DIR="${STATE_DIR:-$ROOT_DIR/tmp/auto-sync}"
STATE_FILE="$STATE_DIR/last_sha"
ARCHIVE_FILE="$STATE_DIR/source.tar.gz"
EXTRACT_DIR="$STATE_DIR/source"
LOG_PREFIX="[server-sync]"

mkdir -p "$STATE_DIR"

fetch_remote_sha() {
  local url="https://api.github.com/repos/${REPO_SLUG}/commits/${ENCODED_BRANCH}"
  node -e "fetch(process.argv[1], { headers: { 'User-Agent': 'ai-content-sync' } }).then(async (res) => { if (!res.ok) throw new Error('HTTP ' + res.status); const data = await res.json(); process.stdout.write(data.sha || ''); }).catch((error) => { console.error(error.message); process.exit(1); });" "$url"
}

REMOTE_SHA="$(fetch_remote_sha)"
LOCAL_SHA="$(cat "$STATE_FILE" 2>/dev/null || true)"

if [[ -z "$REMOTE_SHA" ]]; then
  echo "$LOG_PREFIX 无法获取远端提交信息"
  exit 1
fi

if [[ "${FORCE_SYNC:-0}" != "1" && "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
  echo "$LOG_PREFIX 无新提交，跳过"
  exit 0
fi

echo "$LOG_PREFIX 检测到新版本：${LOCAL_SHA:-<none>} -> $REMOTE_SHA"

docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"

curl -fsSL "https://codeload.github.com/${REPO_SLUG}/tar.gz/refs/heads/${BRANCH}" -o "$ARCHIVE_FILE"
tar -xzf "$ARCHIVE_FILE" -C "$EXTRACT_DIR" --strip-components=1
\cp -arf "$EXTRACT_DIR"/. "$ROOT_DIR"/

cd "$ROOT_DIR/backend"
npm install
npm run build

cd "$ROOT_DIR/frontend"
npm install
npm run build

cd "$ROOT_DIR"
node scripts/upsert-wechat-article-style.js

if pm2 describe ai-content-backend > /dev/null 2>&1; then
  pm2 restart ai-content-backend
else
  cd "$ROOT_DIR/backend"
  pm2 start "npm run start:prod" --name ai-content-backend
fi

if pm2 describe ai-content-frontend > /dev/null 2>&1; then
  pm2 restart ai-content-frontend
else
  cd "$ROOT_DIR/frontend"
  pm2 start "npm run start -- --hostname 0.0.0.0 --port 3000" --name ai-content-frontend
fi

pm2 save

printf '%s' "$REMOTE_SHA" > "$STATE_FILE"
echo "$LOG_PREFIX 自动同步完成"
