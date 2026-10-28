#!/bin/bash
# 构建面板前端并把产物放到 frontend-dist/（Worker 静态资源目录）
# 用法: bash build-frontend.sh [frontend-src]
set -e

SRC="${1:-$(cd "$(dirname "$0")/../frontend" && pwd)}"
OUT="$(cd "$(dirname "$0")" && pwd)/../frontend-dist"

cd "$SRC"

if [ ! -d node_modules ]; then
  echo "==> 安装依赖"
  npm install --no-audit --no-fund
fi

echo "==> 构建"
npm run build

echo "==> 拷贝到 $OUT"
mkdir -p "$OUT"
# 不整目录删除：Windows 上 workerd/杀软可能持有 assets 句柄，删不掉会中断构建。
cp -rf dist/. "$OUT"/

# 前端 index.html 里 window.BASE_URL 由 Go 模板注入，这里是静态托管，
# 直接固定成 "/"：路由和 axios 的相对路径都会解析到根。
sed -i 's|{{ .BASE_URL }}|/|g' "$OUT/index.html"
sed -i 's|window.BASE_URL = "/app/"|window.BASE_URL = "/"|g' "$OUT/index.html"
grep -o 'window.BASE_URL = "[^"]*"' "$OUT/index.html" | head -2

echo "DONE: $OUT"
