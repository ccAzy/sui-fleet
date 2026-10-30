#!/bin/bash
# 构建面板前端并把产物放到 panel/frontend-dist/（Worker 静态资源目录，随仓库提交）
# 用法: bash build-frontend.sh [frontend-src]
set -e

SRC="${1:-$(cd "$(dirname "$0")/../frontend" && pwd)}"
OUT="$(cd "$(dirname "$0")" && pwd)/frontend-dist"

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
cp -rf dist/. "$OUT"

# 但必须剪掉上一次构建的哈希文件：文件名带 [hash]，不剪会无限堆积，
# 且 Worker 静态资源会一起上传。只删 dist 里不存在的文件。
python - "$OUT" <<'PY'
import os, sys
out = sys.argv[1]
for sub in ['assets', '.']:
    d = os.path.join(out, sub)
    if not os.path.isdir(d):
        continue
    for name in os.listdir(d):
        p = os.path.join(d, name)
        if not os.path.isfile(p):
            continue
        rel = name if sub == '.' else f'assets/{name}'
        if not os.path.exists(os.path.join('dist', rel)):
            os.remove(p)
            print('pruned', rel)
PY

# 前端 index.html 里 window.BASE_URL 由 Go 模板注入，这里是静态托管，
# 直接固定成 "/"：路由和 axios 的相对路径都会解析到根。
sed -i 's|{{ .BASE_URL }}|/|g' "$OUT/index.html"
sed -i 's|window.BASE_URL = "/app/"|window.BASE_URL = "/"|g' "$OUT/index.html"
grep -o 'window.BASE_URL = "[^"]*"' "$OUT/index.html" | head -2

# 完整性门禁：panel/frontend-dist 是提交进仓库、直接上传到 Worker 的产物。
# 曾被 pi-lens 的 autofix 在打包后改写压缩代码（let→const 等），造成线上白屏——
# 构建完必须逐文件比对 md5，不一致就直接失败，不给出错误产物。
python - "$OUT" <<'PY'
import hashlib, os, sys
out = sys.argv[1]
bad = []
for root, _, files in os.walk('dist'):
    for name in files:
        rel = os.path.relpath(os.path.join(root, name), 'dist')
        a, b = os.path.join('dist', rel), os.path.join(out, rel)
        if not os.path.exists(b):
            bad.append(rel + ' (missing)')
            continue
        h = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
        # index.html 故意被 sed 改过，不参与比对
        if rel == 'index.html':
            continue
        if h(a) != h(b):
            bad.append(rel + ' (modified)')
if bad:
    print('\n✗ 产物被外部改写，请删掉这些文件后重建：')
    for x in bad:
        print('   ', x)
    sys.exit(1)
print('✓ 产物完整性校验通过（%d 个文件）' % sum(len(f) for _, _, f in os.walk('dist')))
PY

echo "DONE: $OUT"
