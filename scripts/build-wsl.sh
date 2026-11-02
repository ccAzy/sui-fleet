#!/bin/bash
# 在 WSL(Ubuntu) 里编译节点侧 sui-agent（linux/amd64）。
# 用法： wsl -d Ubuntu-24.04 bash /mnt/c/Users/<you>/projects/sui-cf/agent/build-wsl.sh [src-tree]
#
# 需要：$HOME/tools/go/bin/go（Go >= 1.25）、gcc（CGO，sqlite 驱动需要）。
set -e

SRC="${1:-$(cd "$(dirname "$0")/../node" && pwd)}"
WORK="${WORK:-$HOME/build/sui-agent}"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/dist}"



# go.mod 要求 go 1.26.5；用 1.27 编译会在 go-json-experiment/json 上炸。
# 显式挑一个 1.26.x 的 go：历史上这个脚本因为 PATH 里的 go 不存在而"静默产出 0 字节"，
# 所以这里逐个探测并打印实际用的版本，找不到就直接退出。
GO_BIN=""
for d in "$HOME/tools/go126/bin" /tmp/go1265/bin "$HOME/tools/go/bin"; do
  if [ -x "$d/go" ] && "$d/go" version | grep -q "go1\.26"; then GO_BIN="$d"; break; fi
done
if [ -z "$GO_BIN" ]; then
  echo "错误：找不到 go 1.26.x（找过 ~/tools/go126/bin、/tmp/go1265/bin、~/tools/go/bin）" >&2
  exit 1
fi
export PATH="$GO_BIN:$PATH"
export CGO_ENABLED=1
echo "==> 使用 $GO_BIN ($($GO_BIN/go version))"

# WSL 里 DNS 不可用（127.0.0.53 无法解析），依赖先用 Windows 侧下载好，
# 这里直接复用 Windows 的 module cache，并断网构建。
#
# 注意：不能"目录存在就用"——WSL 的 ~/go/pkg/mod 往往是空的或不完整，
# 用了它就会得到一堆 "module lookup disabled by GOPROXY=off"。
# 这里按"是否真的含 sagernet 依赖"来判断缓存完整性。
export GOFLAGS=-mod=mod
find_cache() {
  for c in "$GOMODCACHE" /mnt/c/Users/*/go/pkg/mod "$HOME/go/pkg/mod"; do
    [ -n "$c" ] && [ -d "$c/github.com/sagernet" ] && { echo "$c"; return 0; }
  done
  return 1
}
if C=$(find_cache); then
  export GOMODCACHE="$C"
  export GOPROXY=off
  echo "==> 使用本地 module cache: $GOMODCACHE (offline)"
else
  export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
  echo "==> 未找到完整 module cache，尝试在线拉取"
  go mod download
fi

echo "==> 同步源码 $SRC -> $WORK"
mkdir -p "$WORK"
cp -r "$SRC"/. "$WORK"/

cd "$WORK"

# 不含 with_naive_outbound：它依赖 cronet-go 的预编译 Chromium 静态库（上游用 musl 工具链产出），
# 在普通 glibc 环境链接不上。节点侧不需要 naive 出站时这是最稳的组合。
TAGS="with_quic,with_grpc,with_utls,with_acme,with_gvisor,badlinkname,tfogo_checklinkname0,with_tailscale"

echo "==> 编译 linux/amd64"
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
  go build -tags "$TAGS" -ldflags '-w -s -checklinkname=0' -o sui-agent main.go

# 能力自检：下面这几项缺了，二进制照样能编译、能启动，但 sing-box 会在运行时
# 拒绝启动（reality 需要 uTLS）。曾经 56 MB 的产物就是这样混过 systemctl 检查的。
for sym in "tailscale.com" "uTLS" "with_utls"; do
  n=$(strings sui-agent | grep -c "$sym" || true)
  if [ "$n" -eq 0 ]; then
    echo "错误：产物里找不到 [$sym]，说明构建标签没生效（典型症状：产物 ~56 MB）" >&2
    ls -l sui-agent >&2
    exit 1
  fi
done
SZ=$(stat -c%s sui-agent)
if [ "$SZ" -lt 70000000 ]; then
  echo "错误：产物只有 $SZ 字节（已验证可用版本约 75.6 MB），拒绝发布" >&2
  exit 1
fi
echo "==> 能力自检通过（$(stat -c%s sui-agent) 字节）"

mkdir -p "$OUT_DIR"
cp sui-agent "$OUT_DIR/sui-agent-linux-amd64"
ls -lh "$OUT_DIR/sui-agent-linux-amd64"

echo "==> 编译 linux/arm64（交叉，如果装了 aarch64 gcc 才成功）"
if command -v aarch64-linux-gnu-gcc >/dev/null 2>&1; then
  CGO_ENABLED=1 GOOS=linux GOARCH=arm64 CC=aarch64-linux-gnu-gcc \
    go build -tags "$TAGS" -ldflags '-w -s -checklinkname=0' -o sui-agent-arm64 main.go
  cp sui-agent-arm64 "$OUT_DIR/sui-agent-linux-arm64"
  ls -lh "$OUT_DIR/sui-agent-linux-arm64"
else
  echo "跳过 arm64：未安装 aarch64-linux-gnu-gcc"
fi

echo "DONE"
