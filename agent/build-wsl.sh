#!/bin/bash
# 在 WSL(Ubuntu) 里编译节点侧 sui-agent（linux/amd64）。
# 用法： wsl -d Ubuntu-24.04 bash /mnt/c/Users/<you>/projects/sui-cf/agent/build-wsl.sh [src-tree]
#
# 需要：$HOME/tools/go/bin/go（Go >= 1.25）、gcc（CGO，sqlite 驱动需要）。
set -e

SRC_WIN="/mnt/c/Users/user/build/sui-agent"
WORK="$HOME/build/sui-agent"
OUT_DIR="/mnt/c/Users/user/projects/sui-cf/agent/dist"

if [ -n "$1" ]; then SRC_WIN="$1"; fi

# go.mod 要求 go 1.26.5；用 1.27 编译会在 go-json-experiment/json 上炸
export PATH="$HOME/tools/go126/bin:$HOME/tools/go/bin:$PATH"
export CGO_ENABLED=1

# WSL 里 DNS 不可用（127.0.0.53 无法解析），依赖先用 Windows 侧下载好，
# 这里直接复用 Windows 的 module cache，并断网构建。
WIN_CACHE="/mnt/c/Users/user/go/pkg/mod"
if [ -d "$WIN_CACHE" ]; then
  export GOMODCACHE="$WIN_CACHE"
  export GOFLAGS=-mod=mod
  export GOPROXY=off
  echo "==> 使用 Windows module cache: $GOMODCACHE (offline)"
else
  export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
  export GOFLAGS=-mod=mod
  echo "==> 未找到 Windows cache，尝试在线拉取"
  go mod download
fi

echo "==> 同步源码 $SRC_WIN -> $WORK"
mkdir -p "$WORK"
cp -r "$SRC_WIN"/. "$WORK"/

cd "$WORK"

# 不含 with_naive_outbound：它依赖 cronet-go 的预编译 Chromium 静态库（上游用 musl 工具链产出），
# 在普通 glibc 环境链接不上。节点侧不需要 naive 出站时这是最稳的组合。
TAGS="with_quic,with_grpc,with_utls,with_acme,with_gvisor,badlinkname,tfogo_checklinkname0,with_tailscale"

echo "==> 编译 linux/amd64"
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
  go build -tags "$TAGS" -ldflags '-w -s -checklinkname=0' -o sui-agent main.go

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
