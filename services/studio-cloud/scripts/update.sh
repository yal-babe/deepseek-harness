#!/usr/bin/env bash
# Fetch and build a pinned service revision before replacing this deployment's application container.
set -Eeuo pipefail
umask 077
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$root"
action=${1:-check}
case "$action" in check|update) ;; *) echo '用法：bash scripts/update.sh [check|update]' >&2; exit 2 ;; esac
[[ $# -le 1 ]] || { echo '参数过多。' >&2; exit 2; }
repository=${STUDIO_UPDATE_REPOSITORY:-https://github.com/yal-babe/deepseek-harness.git}
branch=${STUDIO_UPDATE_BRANCH:-studio/main}
fetch_timeout=${STUDIO_UPDATE_FETCH_TIMEOUT:-180}
build_timeout=${STUDIO_UPDATE_BUILD_TIMEOUT:-900}
start_timeout=${STUDIO_UPDATE_START_TIMEOUT:-180}
compose_file=${STUDIO_UPDATE_COMPOSE_FILE:-compose.yaml}
for value in "$fetch_timeout" "$build_timeout" "$start_timeout"; do
  [[ "$value" =~ ^[1-9][0-9]{0,5}$ ]] || { echo '更新超时配置必须为正整数秒数（最多六位）。' >&2; exit 2; }
done
for program in git tar flock timeout mktemp; do
  command -v "$program" >/dev/null || { echo "缺少命令 $program；Ubuntu 请安装 git、tar、util-linux 和 coreutils。" >&2; exit 2; }
done
[[ "$repository" != -* && "$branch" != -* ]] || { echo '仓库或分支参数无效。' >&2; exit 2; }
git check-ref-format --branch "$branch" >/dev/null
state="$root/.studio-update"
mkdir -p -- "$state"
chmod 700 "$state"
exec 9>"$state/lock"
flock -n 9 || { echo '另一更新操作正在进行，请稍后重试。' >&2; exit 1; }
stage=''
phase='fetch'
cleanup() {
  result=$?
  trap - EXIT
  if [[ -n "$stage" ]]; then rm -rf -- "$stage"; fi
  if [[ "$result" -ne 0 ]]; then
    case "$phase" in
      switch|restart)
        printf '%s\n' "phase=$phase" > "$state/FAILED"
        echo '更新未完成：新镜像可能已启动，数据库可能已迁移；没有自动回退数据库或旧镜像。' >&2
        echo '请执行 docker compose logs --tail=100 app 检查；修复后重试更新，或使用更新前的完整备份恢复。' >&2
        ;;
      *) echo '检查或构建失败，尚未切换应用镜像；现有服务配置保持不变。' >&2 ;;
    esac
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose() { docker compose --project-directory "$root" --env-file "$root/.env" -f "$compose_file" "$@"; }
if [[ "$action" == update ]]; then
  command -v docker >/dev/null
  docker compose version >/dev/null
  [[ -f .env && ! -L .env ]] || { echo '请先配置部署目录中的普通文件 .env。' >&2; exit 2; }
  if grep -Eq 'REPLACE_HOST|REPLACE_PASSWORD|^DATABASE_URL=$' .env; then
    echo '请先填写 .env 中的真实 PostgreSQL 连接配置。' >&2; exit 2
  fi
  grep -q 'STUDIO_CLOUD_IMAGE' "$compose_file" || {
    echo 'Compose 尚未接入 STUDIO_CLOUD_IMAGE；请先安装新版部署配置，再运行更新。' >&2; exit 2;
  }
fi
cache="$state/repository.git"
if [[ ! -d "$cache" ]]; then git init --bare --quiet "$cache"; fi
export GIT_TERMINAL_PROMPT=0
echo "正在检查分支：$branch"
timeout --kill-after=10s "$fetch_timeout" git --git-dir="$cache" fetch --depth=1 --no-tags "$repository" "refs/heads/$branch"
revision=$(git --git-dir="$cache" rev-parse --verify 'FETCH_HEAD^{commit}')
tree=$(git --git-dir="$cache" rev-parse --verify "$revision:services/studio-cloud")
echo "远端提交：$revision"
if [[ -f "$state/current" ]]; then printf '上次成功更新：'; cat "$state/current"; fi
if [[ "$action" == check ]]; then exit 0; fi
if [[ -f "$state/current-tree" && -f "$state/current" && "$(cat "$state/current-tree")" == "$tree" && ! -f "$state/FAILED" && ! -f "$state/pending" ]]; then
  active=$(compose ps -q app)
  prior="dsh-studio-cloud:git-$(cat "$state/current")"
  if [[ -n "$active" ]] && [[ "$(docker inspect --format '{{.Config.Image}}' "$active")" == "$prior" ]] \
    && [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$active")" == healthy ]]; then
    echo '服务端源码没有变化，现有应用健康，无需重启。'
    exit 0
  fi
fi
stage=$(mktemp -d "$state/staging.XXXXXX")
git --git-dir="$cache" archive "$revision:services/studio-cloud" | tar -xf - -C "$stage"
target="dsh-studio-cloud:git-$revision"
phase='build'
echo '先构建新镜像；构建成功前不重启现有应用。'
timeout --kill-after=10s "$build_timeout" docker build --pull --label "org.opencontainers.image.revision=$revision" -t "$target" "$stage"
export STUDIO_CLOUD_IMAGE="$target"
compose config --quiet
compose images -q app > "$state/previous-image"
cp -p .env "$state/env.previous"
chmod 600 "$state/env.previous"
awk '!/^[[:space:]]*(export[[:space:]]+)?STUDIO_CLOUD_IMAGE[[:space:]]*=/' .env > "$state/env.next"
printf '\nSTUDIO_CLOUD_IMAGE=%s\n' "$target" >> "$state/env.next"
chmod 600 "$state/env.next"
printf '%s\n' "$revision" > "$state/pending"
phase='switch'
mv -- "$state/env.next" .env
phase='restart'
timeout --kill-after=10s "$((start_timeout + 30))" docker compose --project-directory "$root" --env-file "$root/.env" -f "$compose_file" \
  up -d --no-deps --no-build --wait --wait-timeout "$start_timeout" app
container=$(compose ps -q app)
[[ -n "$container" ]] || { echo '应用容器不存在。' >&2; exit 1; }
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")
[[ "$health" == healthy ]] || { echo '应用健康状态未确认。' >&2; exit 1; }
printf '%s\n' "$revision" > "$state/current"
printf '%s\n' "$tree" > "$state/current-tree"
rm -f -- "$state/FAILED" "$state/pending"
phase='complete'
echo "更新成功，应用健康：$revision"
