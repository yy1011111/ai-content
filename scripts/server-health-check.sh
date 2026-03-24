#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/4] 检查 Docker 基础服务"
docker compose -f "$ROOT_DIR/docker-compose.yml" ps

echo "[2/4] 检查 PM2 进程"
pm2 status

echo "[3/4] 检查本机端口"
curl --fail --silent http://127.0.0.1:3000/login > /dev/null && echo "3000 OK"
curl --fail --silent http://127.0.0.1:3001/api/auth/setup-status > /dev/null && echo "3001 OK"

echo "[4/4] 检查数据库与 Redis 容器健康状态"
docker inspect --format '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ai-content-postgres-1
docker inspect --format '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ai-content-redis-1

echo "服务器自检完成"
