#!/usr/bin/env bash
set -euo pipefail
root="${1:?请指定部署目录}"
tag="${2:?请指定提交 SHA}"
[[ "$root" =~ ^/[a-zA-Z0-9/_-]+$ ]] || exit 2
[[ "$tag" =~ ^[a-f0-9]{40}$ ]] || exit 2
release="$root/releases/$tag"
[[ -f "$root/.env.production" ]] || { echo '服务器缺少 .env.production'; exit 1; }
previous=$(readlink "$root/current" || true)
docker load -i "$release/images.tar.gz"
export DEPLOY_TAG="$tag"
compose=(docker compose --project-name zhuifen --project-directory "$release" --env-file "$root/.env.production" -f "$release/compose.production.yaml" -f "$release/compose.images.yaml")
if "${compose[@]}" up -d --no-build --wait --wait-timeout 180; then
  ln -sfn "$release" "$root/current"
  rm -f "$release/images.tar.gz"
  echo "发布成功：$tag"
else
  echo '新版本未通过健康检查。'
  if [[ -n "$previous" && -f "$previous/compose.images.yaml" ]]; then
    export DEPLOY_TAG="${previous##*/}"
    docker compose --project-name zhuifen --project-directory "$previous" --env-file "$root/.env.production" -f "$previous/compose.production.yaml" -f "$previous/compose.images.yaml" up -d --no-build --wait --wait-timeout 180
    echo "已恢复上个版本：$DEPLOY_TAG"
  fi
  exit 1
fi
