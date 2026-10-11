#!/usr/bin/env bash
set -euo pipefail

# 在 GitHub Actions 执行；服务器已安装 Docker Compose，并准备好 .env.production。
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_SSH_KNOWN_HOSTS:?}"
: "${GITHUB_SHA:?}" "${RUNNER_TEMP:?}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/zhuifen}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ ]] || exit 2
[[ "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || exit 2
[[ "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9/_-]+$ ]] || exit 2
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2

umask 077
ssh_dir=$(mktemp -d "$RUNNER_TEMP/zhuifen-ssh.XXXXXX")
trap 'rm -rf "$ssh_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
options=(-i "$ssh_dir/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
target="$DEPLOY_USER@$DEPLOY_HOST"
release="$DEPLOY_PATH/releases/$GITHUB_SHA"

docker save "zhuifen-api:$GITHUB_SHA" "zhuifen-web:$GITHUB_SHA" | gzip -1 > "$ssh_dir/images.tar.gz"
ssh "${options[@]}" "$target" "mkdir -p '$release/deploy' '$release/scripts'"
scp "${options[@]}" "$ssh_dir/images.tar.gz" compose.production.yaml compose.images.yaml "$target:$release/"
scp "${options[@]}" deploy/Caddyfile "$target:$release/deploy/"
scp "${options[@]}" scripts/activate-release.sh "$target:$release/scripts/"
ssh "${options[@]}" "$target" "bash '$release/scripts/activate-release.sh' '$DEPLOY_PATH' '$GITHUB_SHA'"
