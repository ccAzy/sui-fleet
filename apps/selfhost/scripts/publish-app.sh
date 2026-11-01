#!/usr/bin/env bash
# 把"运行面板所需的代码"打成一个包发布到 /dl/app-bundle.tar.gz，
# 供 promote.sh / install.sh 在任意机器上一条命令拉起控制面。
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
DEST="$REPO/panel/frontend-dist/dl"
mkdir -p "$DEST"

echo "==> 打包运行时源码"
tar czf "$DEST/app-bundle.tar.gz" -C "$REPO" \
  --exclude='node_modules' --exclude='.data' --exclude='frontend-dist/dl' \
  apps/selfhost/src apps/selfhost/scripts apps/selfhost/deploy apps/selfhost/package.json apps/selfhost/package-lock.json \
  panel/src panel/schema.sql panel/package.json panel/package-lock.json \
  panel/frontend-dist

(cd "$DEST" && sha256sum app-bundle.tar.gz >app-bundle.tar.gz.sha256)
ls -lh "$DEST/app-bundle.tar.gz" | awk '{print "  app-bundle.tar.gz", $5}'
echo
echo "下一步：cd panel && npx wrangler deploy --config wrangler.local.toml"
