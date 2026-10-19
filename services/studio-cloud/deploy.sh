#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v docker >/dev/null || { echo '请先安装 Docker Engine 和 Compose 插件。' >&2; exit 1; }
docker compose version >/dev/null
compose_file=${STUDIO_DEPLOY_COMPOSE_FILE:-compose.external-pg.yaml}
case "${1:-}" in
  check|update)
    export STUDIO_UPDATE_COMPOSE_FILE="$compose_file"
    exec bash scripts/update.sh "$1"
    ;;
esac
compose() { docker compose -f "$compose_file" "$@"; }
if [[ ! -f .env ]]; then
  command -v openssl >/dev/null
  cloud_url="${1:-http://localhost:8788}"
  case "$cloud_url" in
    http://*) allow_http=true ;;
    https://*) allow_http=false ;;
    *) echo '服务地址必须以 http:// 或 https:// 开头。' >&2; exit 1 ;;
  esac
  [[ "$cloud_url" != *$'\n'* && "$cloud_url" != *$'\r'* && "$cloud_url" != *' '* && "$cloud_url" != *'#'* ]] || { echo '服务地址不能包含空白或 #。' >&2; exit 1; }
  bind_address=0.0.0.0
  case "$cloud_url" in http://localhost:*|http://127.0.0.1:*|https://*) bind_address=127.0.0.1 ;; esac
  umask 077
  (set -o noclobber
    printf 'DATABASE_URL=postgresql://studio:REPLACE_PASSWORD@REPLACE_HOST:5432/studio\nMASTER_KEY=%s\nBOOTSTRAP_ADMIN=admin\nBOOTSTRAP_PASSWORD=%s\nPUBLIC_URL=%s\nALLOW_HTTP=%s\nBIND_ADDRESS=%s\nPORT=8788\n' \
      "$(openssl rand -hex 32)" "$(openssl rand -hex 18)" "$cloud_url" "$allow_http" "$bind_address" > .env
  )
  echo '已生成独立随机凭据到 .env（权限 600）。'
elif [[ $# -gt 0 ]]; then
  echo '已有 .env，未覆盖配置；请直接编辑其中的 PUBLIC_URL / BIND_ADDRESS / ALLOW_HTTP。'
fi
if grep -Eq 'REPLACE_HOST|REPLACE_PASSWORD|^DATABASE_URL=$' .env; then
  echo '请先编辑 .env 的 DATABASE_URL，填写已有 PostgreSQL 的专用数据库及账号，再重新执行本脚本。' >&2
  exit 1
fi
if ! grep -Eq '^DATABASE_URL=postgres(ql)?://' .env; then
  echo 'DATABASE_URL 必须以 postgresql:// 或 postgres:// 开头。' >&2
  exit 1
fi
image=$(compose config --images | head -n 1)
if docker image inspect "$image" >/dev/null 2>&1; then
  compose up -d --no-build --wait --wait-timeout 180
else
  compose up -d --build --wait --wait-timeout 300
fi
echo '服务已启动。管理页面：PUBLIC_URL/admin；首次密码请在 .env 中查看 BOOTSTRAP_PASSWORD。'
echo '请在首次登录后修改管理员密码；保存 MASTER_KEY，并同时备份现有 PostgreSQL 专用数据库和应用数据卷。'
