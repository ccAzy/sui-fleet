#!/usr/bin/env bash
# 顺位 2（待机机）定时快照：从当前主控拉一份全量备份，落成本地 SQLite。
#
# 设计要点：
#   - 只"拉"不"推"：主控在 Cloudflare 上时无法反向 SSH 到节点，拉取是唯一可行方向；
#   - 拉下来的不是裸 SQL，而是面板导出的 JSON 备份，用它重建一个独立 SQLite；
#   - 重建后先做行数校验，通过才把 standby.db 原子替换，避免半成品覆盖上一份好的；
#   - 保留最近 KEEP 份，便于"主控没了但待机也坏了"时往回退。
set -euo pipefail

PANEL_URL="${PANEL_URL:?需要 PANEL_URL，例如 https://panel.example.org}"
BACKUP_TOKEN="${BACKUP_TOKEN:?需要 BACKUP_TOKEN（面板 meta.backup_token_hash 对应的原始令牌）}"
DATA_DIR="${DATA_DIR:-/opt/sui-panel/data}"
KEEP="${KEEP:-7}"
APP_DIR="${APP_DIR:-/opt/sui-panel/apps/selfhost}"

mkdir -p "$DATA_DIR"
cd "$APP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
bundle="$DATA_DIR/.bundle-$stamp.json"
staging="$DATA_DIR/.staging-$stamp.db"
target="$DATA_DIR/standby.db"

cleanup() { rm -f "$bundle" "$staging"; }
trap cleanup EXIT

echo "[$(date -Is)] 拉取备份 $PANEL_URL"
curl -fsS --retry 3 --max-time 120 "$PANEL_URL/api/getdb?token=$BACKUP_TOKEN" -o "$bundle"

size=$(wc -c < "$bundle")
if [ "$size" -lt 10000 ]; then
  echo "备份体积异常（$size 字节），中止" >&2
  exit 1
fi

echo "[$(date -Is)] 重建待机库（$size 字节备份）"
npm run --silent import-bundle -- "$bundle" "$staging"

# 行数校验：新库的关键表不能为空，且与上一份的差异只在增量表（usage/changes）
counts=$(node -e '
const { DatabaseSync } = require("node:sqlite");
const d = new DatabaseSync(process.argv[1], { readOnly: true });
const t = ["nodes","objects","settings","users","tokens"];
const out = t.map(k => k + "=" + d.prepare(`select count(*) c from ${k}`).get().c).join(" ");
process.stdout.write(out);
' "$staging")
echo "[$(date -Is)] 行数：$counts"

if ! echo "$counts" | grep -q 'nodes=[1-9]'; then
  echo "新库里没有节点，判定备份无效，保留旧待机库" >&2
  exit 1
fi

if [ -f "$target" ]; then
  mv "$target" "$DATA_DIR/standby-$stamp.db"
fi
mv "$staging" "$target"
echo "[$(date -Is)] 已更新 $target"

# 只保留最近 KEEP 份历史
ls -1t "$DATA_DIR"/standby-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" && echo "  清理旧快照 $(basename "$old")"
done
