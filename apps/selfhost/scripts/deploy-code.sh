#!/usr/bin/env bash
# 从开发机把「代码」推到自托管主控（只换代码与前端产物，不碰数据库）。
#
#   HOST=192.0.2.10 bash apps/selfhost/scripts/deploy-code.sh
#
# 为什么需要它：promote.sh 会连数据库一起覆盖（那是给"新机器首次接管"用的），
# 在正在跑的主控上直接跑它会把线上数据换成旧的。日常改代码要用这个脚本。
#
# 行为：
#   1. 打包 panel/src + apps/selfhost/src + panel/frontend-dist
#   2. 远端备份当前代码目录（带时间戳）
#   3. 覆盖代码，restart 面板（约 2 秒），health 自检
#   4. 失败自动回滚到备份并再次重启
set -euo pipefail

HOST="${HOST:?需要 HOST，例如 HOST=192.0.2.10}"
SSH_PORT="${SSH_PORT:-6688}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE="${REMOTE:-/opt/sui-panel}"
DOMAIN="${DOMAIN:-hksui.example.com}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "==> 打包代码"
tar czf "$tmp/code.tar.gz" -C "$REPO" \
  apps/selfhost/src apps/selfhost/scripts \
  panel/src panel/schema.sql panel/package.json \
  panel/frontend-dist

echo "==> 上传（$(du -h "$tmp/code.tar.gz" | cut -f1)）"
scp -P "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "$tmp/code.tar.gz" "root@$HOST:/tmp/code.tar.gz"

echo "==> 远端替换 + 重启"
ssh -p "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "root@$HOST" bash -s <<REMOTE_SH
set -euo pipefail
STAMP=\$(date +%Y%m%d-%H%M%S)
BK=/opt/sui-panel/backup/code-\$STAMP
mkdir -p /opt/sui-panel/backup
# 只备份会被覆盖的两处
mkdir -p "\$BK"
cp -a /opt/sui-panel/panel/src "\$BK/panel-src"
cp -a /opt/sui-panel/panel/frontend-dist "\$BK/frontend-dist"
cp -a /opt/sui-panel/apps/selfhost/src "\$BK/apps-src"
echo "  已备份代码到 \$BK"

tar xzf /tmp/code.tar.gz -C /opt/sui-panel
rm -f /tmp/code.tar.gz

# 依赖变了才装（package.json 有更新时）
( cd /opt/sui-panel/apps/selfhost && npm install --no-audit --no-fund >/dev/null 2>&1 )

systemctl restart sui-panel
for i in \$(seq 1 15); do
  sleep 1
  if curl -fsS --max-time 3 http://127.0.0.1:8788/health 2>/dev/null | grep -q '"ok":true'; then
    echo "  health OK（重启后 \$i 秒）"
    exit 0
  fi
done

echo "  health 失败 → 回滚"
cp -a "\$BK/panel-src" /opt/sui-panel/panel/src
cp -a "\$BK/frontend-dist" /opt/sui-panel/panel/frontend-dist
cp -a "\$BK/apps-src" /opt/sui-panel/apps/selfhost/src
systemctl restart sui-panel
exit 1
REMOTE_SH

echo "==> 对外自检"
curl -fsS --max-time 8 "https://$DOMAIN/health" | head -c 120; echo
echo "完成。前端产物是每次请求读盘的，所以只改前端甚至不需要重启。"
