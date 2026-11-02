#!/usr/bin/env bash
# 把编译好的 agent 发布到面板静态分发目录 /dl/（供 /install.sh 下载）。
#
# 为什么要分片：Cloudflare 静态资源单文件上限 25 MiB，而 agent 的 gz 约 33MB。
# 产物：
#   sui-agent-linux-amd64.gz.part-00/01/...  +  .parts（分片数）+ .sha256（整包校验）
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENT_BIN="${1:-$REPO/dist/sui-agent-linux-amd64}"
DEST="$REPO/panel/frontend-dist/dl"
PART_MB="${PART_MB:-24}"

[ -f "$AGENT_BIN" ] || {
  echo "找不到二进制：$AGENT_BIN（先跑 scripts/build-wsl.sh）" >&2
  exit 1
}
mkdir -p "$DEST"

publish() { # publish <源二进制> <文件名>
  local src="$1" name="$2"
  local gz="$DEST/$name.gz"
  gzip -9 -c "$src" >"$gz"
  sha256sum "$gz" | cut -d' ' -f1 >"$DEST/$name.sha256"

  rm -f "$DEST/$name".part-*
  split -b "$((PART_MB * 1024 * 1024))" -d -a 2 "$gz" "$DEST/$name.part-"
  local n
  n=$(ls "$DEST/$name".part-* | wc -l | tr -d ' ')
  echo "$n" >"$DEST/$name.parts"
  rm -f "$gz"
  printf '  %-28s %s 个分片，共 %s MB\n' "$name" "$n" "$(($(du -cm "$DEST/$name".part-* | tail -1 | cut -f1)))"
}

echo "==> 发布 agent"
# 名字必须跟着源文件走：原来写死 amd64，传 arm64 会把 amd64 的分片覆盖成 arm64 的，
# 结果 x86 机器装到 aarch64 二进制（装完起不来，且看不出原因）。
case "$AGENT_BIN" in
*sui-agent-linux-arm64*) publish "$AGENT_BIN" "sui-agent-linux-arm64" ;;
*) publish "$AGENT_BIN" "sui-agent-linux-amd64" ;;
esac

# 同时存在两种架构时一次性都发出去，避免「只发了 amd64、arm 机器 404」。
for arch in arm64; do
  alt="$REPO/dist/sui-agent-linux-$arch"
  if [ "$AGENT_BIN" != "$alt" ] && [ -f "$alt" ]; then
    publish "$alt" "sui-agent-linux-$arch"
  fi
done

if [ -f "$REPO/dist/komari-agent-linux-amd64" ]; then
  echo "==> 发布 komari 探针"
  publish "$REPO/dist/komari-agent-linux-amd64" "komari-agent-linux-amd64"
fi

echo
echo "下一步：cd panel && npx wrangler deploy --config wrangler.local.toml"
echo "装完之后可以 rm -rf panel/frontend-dist/dl 再部署一次，把体积收回去。"
