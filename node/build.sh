#!/bin/sh

# 前端在仓库根的 frontend/（上游是 node/frontend 子模块，本仓库没有那个路径）。
# 找不到就直接报错，别让 `cd` 失败后继续往下跑出一堆莫名错误。
FRONTEND="${FRONTEND:-../frontend}"
[ -d "$FRONTEND" ] || {
  echo "找不到前端目录：$FRONTEND" >&2
  echo "从仓库根执行：cd node && bash build.sh；或用 FRONTEND=/路径/to/frontend bash build.sh" >&2
  exit 1
}

( cd "$FRONTEND" && npm i && npm run build )

echo "Backend"

mkdir -p web/html
rm -fr web/html/*
cp -R "$FRONTEND/dist/"* web/html/

BUILD_TAGS="with_quic,with_grpc,with_utls,with_acme,with_gvisor,with_naive_outbound,with_musl,badlinkname,tfogo_checklinkname0,with_tailscale"
go build -ldflags '-w -s -checklinkname=0 -extldflags "-Wl,-no_warn_duplicate_libraries"' -tags "$BUILD_TAGS" -o sui main.go
