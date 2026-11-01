#!/usr/bin/env bash
# 在目标机上把「控制面」拉起来：装 Node → 拉代码包 → 拉最新库 → 起服务 → 自检。
# 不含 DNS 切换（那一步由仲裁者或人工完成，见 apps/arbiter）。
#
#   bash promote.sh --primary https://panel.example.com --token <OPS_TOKEN> [--dry-run]
#
# 幂等：重复执行只会更新代码与数据（旧库自动留 .bak），不会动已有 /etc/sui-panel.env。
set -euo pipefail

PRIMARY=""
OPS_TOKEN=""
DRY=0
FORCE_DB=0
PORT="${PORT:-8788}"
DIR="${DIR:-/opt/sui-panel}"
while [ $# -gt 0 ]; do
  case "$1" in
  --primary)
    PRIMARY="${2:-}"
    shift 2
    ;;
  --token)
    OPS_TOKEN="${2:-}"
    shift 2
    ;;
  --dry-run)
    DRY=1
    shift
    ;;
  --port)
    PORT="${2:-}"
    shift 2
    ;;
  --dir)
    DIR="${2:-}"
    shift 2
    ;;
  *)
    echo "未知参数: $1" >&2
    exit 2
    ;;
  esac
done
[ -n "$PRIMARY" ] && [ -n "$OPS_TOKEN" ] || {
  echo "需要 --primary 与 --token（面板 → /api/getdb 用的运维令牌）" >&2
  exit 2
}

step() { printf '\n==> %s\n' "$1"; }
ok() { printf '  OK   %s\n' "$1"; }
warn() { printf '  WARN %s\n' "$1"; }
die() {
  printf '  FAIL %s\n' "$1" >&2
  exit 1
}

step "1/8 前置检查"
. /etc/os-release 2>/dev/null || true
case "$(uname -m)" in x86_64 | amd64) A=x64 ;; aarch64 | arm64) A=arm64 ;; *) die "架构 $(uname -m) 不受支持" ;; esac
command -v systemctl >/dev/null || die "没有 systemd"
free_gb=$(df -BG / | tail -1 | awk '{gsub("G","",$4); print $4}')
[ "${free_gb:-0}" -ge 2 ] || die "磁盘不足（${free_gb}G，需要 ≥2G）"
if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  systemctl is-active sui-panel >/dev/null 2>&1 || die "端口 $PORT 被别的进程占用"
fi
ok "$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '\"') / $A / ${free_gb}G 可用"

if [ "$DRY" = "1" ]; then
  step "dry-run：以下动作不会执行"
  echo "  - 确保 Node ≥22.5（缺失则下载官方 tarball 到 /opt/node）"
  echo "  - 下载 $PRIMARY/dl/app-bundle.tar.gz 并解包到 $DIR"
  echo "  - npm install（selfhost + panel --omit=dev）"
  echo "  - 从 $PRIMARY/api/getdb 拉最新库 → 导入 $DIR/data/sui.db（旧库留 .bak）"
  echo "  - 写 /etc/sui-panel.env（缺省生成 JWT_SECRET）与 sui-panel.service"
  echo "  - 启动并自检 http://127.0.0.1:$PORT/health"
  exit 0
fi

step "2/8 Node 运行时"
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -v | sed 's/v//' | cut -d. -f1)
  [ "$major" -ge 22 ] && node -e "require('node:sqlite')" 2>/dev/null && need_node=0
fi
if [ "$need_node" = "1" ]; then
  ver="v24.10.0"
  echo "  下载 Node $ver"
  curl -fsSL --retry 3 -o /tmp/node.tar.xz "https://nodejs.org/dist/$ver/node-$ver-linux-$A.tar.xz"
  mkdir -p /opt/node && tar xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  rm -f /tmp/node.tar.xz
fi
# 只有「本机没 Node、刚才装到 /opt/node」时才需要把 /opt/node/bin 提到前面。
# 已有 Node ≥22.5 的机器上不装 /opt/node，硬加会让后面的 /opt/node/bin/npm 指向不存在的文件。
if [ "$need_node" = "1" ]; then
  export PATH=/opt/node/bin:$PATH
fi
NPM_BIN="$(command -v npm || true)"
NODE_BIN="$(command -v node || true)"
if [ -z "$NPM_BIN" ] || [ -z "$NODE_BIN" ]; then
  die "找不到 npm/node（需要 Node ≥22.5）"
fi
NODE_DIR="$(dirname "$NODE_BIN")"
ok "node $(node -v)（$NODE_DIR）"

step "3/8 拉代码包"
mkdir -p "$DIR"
curl -fsSL --retry 3 "$PRIMARY/dl/app-bundle.tar.gz" -o /tmp/app.tar.gz
want=$(curl -fsSL --max-time 20 "$PRIMARY/dl/app-bundle.tar.gz.sha256" | cut -d' ' -f1)
got=$(sha256sum /tmp/app.tar.gz | cut -d' ' -f1)
[ "$want" = "$got" ] || die "代码包校验失败"
tar xzf /tmp/app.tar.gz -C "$DIR"
rm -f /tmp/app.tar.gz
ok "已解包到 $DIR"

step "4/8 安装依赖"
(cd "$DIR/apps/selfhost" && npm install --no-audit --no-fund >/dev/null 2>&1)
(cd "$DIR/panel" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1)
ok "依赖就绪"

step "5/8 拉最新库"
mkdir -p "$DIR/data"
curl -fsSL --retry 3 --max-time 180 "$PRIMARY/api/getdb?token=$OPS_TOKEN" -o /tmp/bundle.json
size=$(wc -c </tmp/bundle.json)
[ "$size" -gt 10000 ] || die "备份体积异常（$size 字节），检查 token"

# 安全检查：本地库比备份新时跳过导入（除非 --force-db）。
# 否则在正在跑的主控上重跑 promote，会把线上数据换成旧快照——真实的丢数据风险。
local_seen=0
if [ -f "$DIR/data/sui.db" ]; then
  local_seen=$(node -e '
const { DatabaseSync } = require("node:sqlite")
try {
  const d = new DatabaseSync(process.argv[1], { readOnly: true })
  const r = d.prepare("select max(last_seen) m from nodes").get()
  process.stdout.write(String(r && r.m ? r.m : 0))
} catch { process.stdout.write("0") }
' "$DIR/data/sui.db" 2>/dev/null || echo 0)
fi
bundle_at=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("/tmp/bundle.json","utf8")).exported_at||0))' 2>/dev/null || echo 0)

if [ "$local_seen" -gt "$bundle_at" ] && [ "$FORCE_DB" != "1" ]; then
  warn "本地库比备份新（本地最后心跳 $local_seen > 备份时间 $bundle_at），跳过导入"
  warn "确实要用备份覆盖就加 --force-db"
else
  [ -f "$DIR/data/sui.db" ] && cp "$DIR/data/sui.db" "$DIR/data/sui.db.bak-$(date +%Y%m%d-%H%M%S)"
  (cd "$DIR/apps/selfhost" && npm run --silent import-bundle -- /tmp/bundle.json "$DIR/data/sui.db" | tail -3)
  ok "库已导入"
fi
rm -f /tmp/bundle.json

step "6/8 配置与单元"
if [ ! -f /etc/sui-panel.env ]; then
  printf 'JWT_SECRET=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >/etc/sui-panel.env
  chmod 600 /etc/sui-panel.env
  ok "已生成 /etc/sui-panel.env"
else
  ok "沿用已有 /etc/sui-panel.env"
fi
cat >/etc/systemd/system/sui-panel.service <<UNIT
[Unit]
Description=s-ui Cloud 控制面（自托管）
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR/apps/selfhost
EnvironmentFile=/etc/sui-panel.env
Environment=SUI_DB=$DIR/data/sui.db
Environment=SUI_DIST=$DIR/panel/frontend-dist
Environment=PORT=$PORT
Environment=PANEL_BASE=$PRIMARY
Environment=PATH=${NODE_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=${NPM_BIN} start
Restart=always
RestartSec=5
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DIR/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable sui-panel >/dev/null 2>&1 || true
ok "单元已写入"

step "7/8 启动"
systemctl restart sui-panel
for i in $(seq 1 20); do
  sleep 1
  if out=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" 2>/dev/null); then
    echo "$out" | grep -q '"ok":true' && {
      ok "health: $out"
      break
    }
  fi
  [ "$i" = "20" ] && {
    journalctl -u sui-panel -n 15 --no-pager
    die "服务未就绪"
  }
done

step "8/8 自检"
ok "服务状态: $(systemctl is-active sui-panel)"
ok "首页: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/")"
nodecount=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/health" | sed -n 's/.*"epoch":\([0-9]*\).*/\1/p')
echo "  当前 epoch: ${nodecount:-?}（切换时由仲裁者 +1）"
echo
echo "这台已是可工作的控制面。切 DNS 指向它即可完成移交；回滚见 apps/selfhost/scripts/restore.sh。"
