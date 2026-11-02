#!/usr/bin/env bash
# 从开发机把「代码」推到自托管主控（只换代码与前端产物，不碰数据库）。
#
#   HOST=203.0.113.11 bash apps/selfhost/scripts/deploy-code.sh
#
# 为什么需要它：promote.sh 会连数据库一起覆盖（那是给"新机器首次接管"用的），
# 在正在跑的主控上直接跑它会把线上数据换成旧快照。日常改代码用这个脚本。
#
# 行为：打包 → 上传 → 远端备份旧代码 → 覆盖 → 重启 → health 自检 → 失败自动回滚
set -euo pipefail

HOST="${HOST:?需要 HOST，例如 HOST=203.0.113.11}"
SSH_PORT="${SSH_PORT:-6688}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE="${REMOTE:-/opt/sui-panel}"
# 外网自检用的域名：默认从远端 panel 单元的 PANEL_BASE 自动取，取不到才跳过。
# （不要在这里写死域名——仓库里的默认值必须是示例域名，写死成示例域名会让自检失效）
DOMAIN="${DOMAIN:-}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "==> 打包代码"
# panel/frontend-dist/dl 是 agent 二进制分片（25MB），代码更新不需要它
tar czf "$tmp/code.tar.gz" -C "$REPO" \
  --exclude='panel/frontend-dist/dl' \
  apps/selfhost/src apps/selfhost/scripts \
  apps/selfhost/package.json apps/selfhost/tsconfig.json \
  panel/src panel/schema.sql panel/package.json \
  panel/frontend-dist

echo "==> 上传（$(du -h "$tmp/code.tar.gz" | cut -f1)）"
scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "$tmp/code.tar.gz" "root@$HOST:/tmp/code.tar.gz"

# 远端脚本单独写成文件再执行：避免 heredoc 里 \$ 转义、CRLF 之类的坑
cat >"$tmp/remote.sh" <<'REMOTE_SH'
set -euo pipefail
# 远端脚本通过 ssh 执行，非登录 shell 的 PATH 里没有 /opt/node/bin，
# npm/node 会"找不到命令"。显式补齐，否则依赖安装会静默失败（实测踩过一次）。
export PATH="/opt/node/bin:$PATH"

STAMP=$(date +%Y%m%d-%H%M%S)
BK=/opt/sui-panel/backup/code-$STAMP
mkdir -p /opt/sui-panel/backup "$BK"
cp -a /opt/sui-panel/panel/src "$BK/panel-src"
cp -a /opt/sui-panel/panel/frontend-dist "$BK/frontend-dist"
cp -a /opt/sui-panel/apps/selfhost/src "$BK/apps-src"
echo "  已备份旧代码 → $BK"

tar xzf /tmp/code.tar.gz -C /opt/sui-panel
rm -f /tmp/code.tar.gz

# 清掉旧入口包：index-<hash>.js 每次构建都换名，覆盖式解包会留下历史版本，
# 让 grep 排查时误判"改动没生效"。只保留 index.html 真正引用的那一个。
cd /opt/sui-panel/panel/frontend-dist
CUR=$(grep -o 'assets/index-[^"]*\.js' index.html | head -1 | xargs -r basename)
if [ -n "$CUR" ]; then
  for f in assets/index-*.js; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = "$CUR" ] || rm -f "$f"
  done
  echo "  入口包已收敛到 $CUR"
fi
# 依赖必须跟着代码走：只同步源码而不同步 node_modules，新增一个依赖就会让面板起不来
# （实测：加了 zod 之后 /health 一直失败，靠回滚才发现）。
# 两个包都要装：apps/selfhost 是运行入口，panel 是被它 import 的业务代码。
for pkg in panel apps/selfhost; do
  if ! ( cd "/opt/sui-panel/$pkg" && npm install --no-audit --no-fund --prefer-offline >/dev/null 2>&1 ); then
    # 不能只告警继续：依赖没装完就重启，服务起不来，而旧进程已经被 systemctl 停掉，
    # 结果是一次“自己把自己弄故障”的部署。这里直接退出，旧进程不动。
    echo "  错误：$pkg 依赖安装失败，中止部署（未重启，旧版本继续运行）" >&2
    exit 1
  fi
done

systemctl restart sui-panel
for i in $(seq 1 15); do
  sleep 1
  if curl -fsS --max-time 3 http://127.0.0.1:8788/health 2>/dev/null | grep -q '"ok":true'; then
    echo "  health OK（重启后 ${i}s）"
    exit 0
  fi
done

echo "  health 失败 → 回滚"
# 注意末尾的 /. ：`cp -a 源目录 目标目录` 在目标已存在时会把源目录塞进去，
# 变成 target/panel-src，回滚实际什么都没换回来（已复现）。
cp -a "$BK/panel-src/." /opt/sui-panel/panel/src/
cp -a "$BK/frontend-dist/." /opt/sui-panel/panel/frontend-dist/
cp -a "$BK/apps-src/." /opt/sui-panel/apps/selfhost/src/
systemctl restart sui-panel
exit 1
REMOTE_SH

echo "==> 远端替换 + 重启"
scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "$tmp/remote.sh" "root@$HOST:/tmp/deploy-remote.sh"
ssh -p "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "root@$HOST" "bash /tmp/deploy-remote.sh"

if [ -z "$DOMAIN" ]; then
  DOMAIN=$(ssh -n -p "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "root@$HOST" "sed -n 's/^Environment=PANEL_BASE=//p' /etc/systemd/system/sui-panel.service" 2>/dev/null | tr -d '
')
  case "$DOMAIN" in https://*) DOMAIN="${DOMAIN#https://}" ;; esac
fi

echo "==> 对外自检"
if [ -z "$DOMAIN" ]; then
  echo "  （跳过外网自检：未指定 DOMAIN，且远端单元里没有 PANEL_BASE）"
elif curl -fsS --max-time 8 "https://$DOMAIN/health" >/dev/null; then
  echo "  https://$DOMAIN/health OK"
else
  echo "  （外网探测失败；本机 health 已通过，多半是本地网络/代理问题）"
fi
echo "完成。前端产物是每次请求读盘的，所以只改前端甚至不需要重启。"
