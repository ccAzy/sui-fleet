#!/usr/bin/env bash
#
# deploy.sh —— 一条命令把 s-ui Cloud 面板部署到 Cloudflare
#
# 用法（在 deploy/panel 目录，或任意位置指定目录）：
#   bash deploy.sh                    # 交互式，缺什么问什么
#   bash deploy.sh --domain panel.example.com
#
# 它会做：装依赖 → 构建前端 → 登录 → 建库 → 写配置 → 建表 → 部署 → 设密钥
# 幂等：重复跑不会重复建库，已存在的 secret 会提示跳过。
set -euo pipefail

cd "$(dirname "$0")"

DOMAIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 环境
command -v node >/dev/null || die "没装 Node.js（需要 18+）"
command -v npm  >/dev/null || die "没装 npm"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "Node 版本太低（当前 $NODE_MAJOR，需要 18+）"

# wrangler 走代理时常连不上 Cloudflare 的 OAuth 端点，且优先解析 IPv6 会超时。
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy 2>/dev/null || true
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"

# ---------------------------------------------------------------- 依赖 + 前端
if [ ! -d node_modules ]; then
  say "安装依赖"
  npm install --no-audit --no-fund
fi

say "构建前端（产物写到 ../frontend-dist）"
npm run build:web

# ---------------------------------------------------------------- 登录
say "检查 Cloudflare 登录状态"
if ! npx wrangler whoami >/dev/null 2>&1; then
  warn "还没登录，接下来会打开浏览器授权"
  npx wrangler login
fi
ACCOUNT=$(npx wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1 || true)
[ -n "$ACCOUNT" ] && echo "账号 ID: $ACCOUNT"

# ---------------------------------------------------------------- 建库（幂等）
DB_NAME=$(grep -oE 'database_name *= *"[^"]+"' wrangler.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
DB_NAME=${DB_NAME:-sui-panel}

say "检查 D1 数据库 $DB_NAME"
EXISTING_ID=$(npx wrangler d1 list --json 2>/dev/null \
  | tr -d '\n' \
  | grep -oE "\{[^{}]*\"name\"[^{}]*\"$DB_NAME\"[^{}]*\}" \
  | grep -oE '"uuid" *: *"[^"]+"' | head -1 | sed 's/.*"\(.*\)"/\1/' || true)

if [ -z "$EXISTING_ID" ]; then
  say "创建 D1 数据库 $DB_NAME"
  npx wrangler d1 create "$DB_NAME"
  EXISTING_ID=$(npx wrangler d1 list --json 2>/dev/null \
    | tr -d '\n' \
    | grep -oE "\{[^{}]*\"name\"[^{}]*\"$DB_NAME\"[^{}]*\}" \
    | grep -oE '"uuid" *: *"[^"]+"' | head -1 | sed 's/.*"\(.*\)"/\1/' || true)
fi
[ -n "$EXISTING_ID" ] || die "拿不到 database_id，请到 Dashboard 确认 D1 是否创建成功"
echo "database_id: $EXISTING_ID"

# ---------------------------------------------------------------- 写配置
say "写入 wrangler.toml"
python - "$EXISTING_ID" "$DOMAIN" <<'PY'
import re, sys, pathlib
db_id, domain = sys.argv[1], sys.argv[2]
p = pathlib.Path('wrangler.toml')
s = p.read_text(encoding='utf-8')
s = re.sub(r'database_id *= *"[^"]*"', f'database_id = "{db_id}"', s)
if domain:
    s = re.sub(r'PANEL_BASE *= *"[^"]*"', f'PANEL_BASE = "https://{domain}"', s)
    if '[[routes]]' not in s:
        s = s.replace('[triggers]', f'[[routes]]\npattern = "{domain}"\ncustom_domain = true\n\n[triggers]')
    else:
        s = re.sub(r'pattern *= *"[^"]*"', f'pattern = "{domain}"', s)
p.write_text(s, encoding='utf-8', newline='\n')
print('  database_id 已写入')
print('  自定义域名: ' + (domain or '未设置（部署后可用 *.workers.dev 访问，国内不稳）'))
PY

# ---------------------------------------------------------------- 建表
say "建表（schema.sql）"
npx wrangler d1 execute DB --remote --file=./schema.sql

# ---------------------------------------------------------------- 部署
say "部署 Worker"
npx wrangler deploy

# ---------------------------------------------------------------- 密钥
say "设置管理员密码"
echo "（登录用；不设则默认 admin/admin 且强制首次改密）"
if npx wrangler secret put ADMIN_PASS; then
  echo "ADMIN_PASS 已设置"
else
  warn "跳过 ADMIN_PASS"
fi

say "设置 JWT 签名密钥（可留空，面板会自动生成并存库）"
npx wrangler secret put JWT_SECRET || warn "跳过 JWT_SECRET"

# ---------------------------------------------------------------- 收尾
say "部署完成"
cat <<'EOF'

接下来：
  1. 打开面板域名登录（用户名 admin，密码是你刚设的 ADMIN_PASS）
  2. Servers → Add Server 建第一台节点，复制一次性 token
  3. 在服务器上跑：
       bash install-agent.sh --panel https://你的域名 --token <token> --bin ./sui-agent-linux-amd64
  4. 30 秒内节点会显示 Online

节点侧不需要 Node.js / npm / Docker / 单独装 sing-box。
EOF
