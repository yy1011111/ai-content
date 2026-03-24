#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/5] 拉起 Docker 基础服务"
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

echo "[2/5] 等待数据库与 Redis"
sleep 5

echo "[3/5] 重启后端"
if pm2 describe ai-content-backend > /dev/null 2>&1; then
  pm2 restart ai-content-backend
else
  cd "$ROOT_DIR/backend"
  pm2 start "npm run start:prod" --name ai-content-backend
fi

echo "[4/5] 重启前端"
if pm2 describe ai-content-frontend > /dev/null 2>&1; then
  pm2 restart ai-content-frontend
else
  cd "$ROOT_DIR/frontend"
  pm2 start "npm run start -- --hostname 0.0.0.0 --port 3000" --name ai-content-frontend
fi

echo "[5/5] 保存 PM2 进程列表"
pm2 save

echo "一键修复完成，建议再执行 scripts/server-health-check.sh 复核。"
