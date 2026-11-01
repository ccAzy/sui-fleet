#!/bin/bash
# 构建面板前端并把产物放到 panel/frontend-dist/（Worker 静态资源目录，随仓库提交）
# 用法: bash build-frontend.sh [frontend-src]
set -e

SRC="${1:-$(cd "$(dirname "$0")/../frontend" && pwd)}"
OUT="$(cd "$(dirname "$0")" && pwd)/frontend-dist"

# 只用 python3：Debian/Ubuntu 24 之后没有 "python" 这个名字，
# deploy.sh 早就做了这种兜底，但本脚本原来两处写死 python，会在这里直接失败。
PYTHON="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON" ]; then
  echo "需要 python3（用于子集化 MDI 与产物校验）" >&2
  exit 1
fi

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
"$PYTHON" - "$OUT" <<'PY'
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

# BASE_URL 不再由 sed 注入：index.html 里已经没有内联脚本，
# 改由 frontend/public/boot.js 在首帧前给出（见该文件注释——抽出去是为了 CSP 能写死 'self'）。
grep -o '<script src="[^"]*"></script>' "$OUT/index.html" | head -2

# 完整性门禁：panel/frontend-dist 是提交进仓库、直接上传到 Worker 的产物。
# 曾被 pi-lens 的 autofix 在打包后改写压缩代码（let→const 等），造成线上白屏——
# 构建完必须逐文件比对 md5，不一致就直接失败，不给出错误产物。
"$PYTHON" - "$OUT" <<'PY'
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
