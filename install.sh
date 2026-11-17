#!/usr/bin/env bash
#
# s-ui Cloud 一键安装 —— 一条命令，从裸机到「打开网址就能登录」
#
#   curl -fsSL https://raw.githubusercontent.com/exampleuser/sui-fleet/main/install.sh | sudo bash
#
# 装什么：
#   1. Node ≥ 22.5（没有就装官方二进制，走 npmmirror 镜像）
#   2. 面板（apps/selfhost，跑在 systemd 里，SQLite 存本地）
#   3. 同机节点 agent（装好即可在面板里看到「本机」节点在线）
#
# 可选参数：
#   --domain panel.example.com   装完自动装 Caddy 反代（自签证书，配 Cloudflare Full 模式）
#   --port 8788                  面板监听端口（默认 8788）
#   --src  <tar.gz 或 git URL>   代码来源（默认从 GitHub 拉 main 分支）
#   --agent <二进制 URL>         节点 agent（默认从 --src 同源目录取）
#   --no-agent                   只装面板，不装本机节点
#   --dir /opt/sui-panel         安装目录
#   --service sui-panel          systemd 服务名
#   --user sui                   服务账号
#   --force                      已安装时强制覆盖代码（数据库不动）
#
# 幂等：重复执行不会丢数据，只更新代码与前端产物。
#
set -euo pipefail

# ---------------------------------------------------------------- 输出
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_0=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_0=''
fi
say()  { printf '%s==>%s %s\n' "$C_OK" "$C_0" "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_WARN" "$C_0" "$*" >&2; }
die()  { printf '%s[x]%s %s\n' "$C_ERR" "$C_0" "$*" >&2; exit 1; }
dim()  { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_0"; }

# ---------------------------------------------------------------- 参数
DOMAIN=""
PORT="8788"
SRC="https://github.com/exampleuser/sui-fleet/archive/refs/heads/main.tar.gz"
AGENT_URL=""
WITH_AGENT=1
FORCE=0
SKIP_DEPS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN="${2:-}"; shift 2 ;;
    --port)     PORT="${2:-}"; shift 2 ;;
    --src)      SRC="${2:-}"; shift 2 ;;
    --agent)    AGENT_URL="${2:-}"; shift 2 ;;
    --no-agent) WITH_AGENT=0; shift ;;
    --force)    FORCE=1; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;   # 离线/测试用：假设 node_modules 已经在包里
    --dir)      INSTALL_DIR="${2:-}"; shift 2 ;;   # 安装目录（默认 /opt/sui-panel）
    --service)  SVC_NAME="${2:-}"; shift 2 ;;      # systemd 服务名（默认 sui-panel）
    --user)     SVC_USER="${2:-}"; shift 2 ;;      # 服务账号（默认 sui）
    -h|--help)  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          die "未知参数: $1（用 --help 看用法）" ;;
  esac
done

# ---------------------------------------------------------------- 前置检查
[ "$(id -u)" -eq 0 ] || die "需要 root：curl ... | sudo bash"

[ -d /run/systemd/system ] || die "没有 systemd —— 这个脚本按 systemd 管理服务，容器里请用别的方式部署"

case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "不支持的架构: $(uname -m)（目前只出 amd64 / arm64）" ;;
esac

. /etc/os-release 2>/dev/null || true
OS_ID="${ID:-unknown}"
OS_LIKE="${ID_LIKE:-}"
dim "系统: ${PRETTY_NAME:-$OS_ID}  架构: $ARCH"
case "$OS_ID $OS_LIKE" in
  *debian*|*ubuntu*) : ;;
  *) warn "没在 Debian/Ubuntu 上测过；缺依赖时请手动装 curl、tar、xz" ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"; }
need curl; need tar; need systemctl

INSTALL_DIR="${INSTALL_DIR:-/opt/sui-panel}"
SVC_NAME="${SVC_NAME:-sui-panel}"
SVC_USER="${SVC_USER:-sui}"
# 数据目录跟随服务名，避免并行装两套时抢同一个 sqlite
DATA_DIR="${DATA_DIR:-/var/lib/${SVC_NAME}}"

# ---------------------------------------------------------------- 1. Node
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0; }

need_node=1
if command -v node >/dev/null 2>&1; then
  MAJ=$(node_major)
  if [ "$MAJ" -ge 22 ] && node -e 'require("node:sqlite")' >/dev/null 2>&1; then
    say "Node 已就绪：$(node -v)"
    need_node=0
  else
    warn "Node $(node -v) 不满足要求（需要 ≥22.5 且带 node:sqlite）"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  NODE_VER="22.23.2"
  # 国内直连 nodejs.org 常年超时，优先用 npmmirror
  MIRROR="${NODE_MIRROR:-https://npmmirror.com/mirrors/node}"
  say "安装 Node v${NODE_VER}（${ARCH}）"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  if ! curl -fsSL --retry 2 --max-time 180 \
      "${MIRROR}/v${NODE_VER}/node-v${NODE_VER}-linux-${ARCH}.tar.xz" -o "$TMP/node.tar.xz"; then
    warn "镜像下载失败，改试官方源"
    curl -fsSL --retry 2 --max-time 300 \
      "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${ARCH}.tar.xz" -o "$TMP/node.tar.xz" \
      || die "Node 下载失败。请手动装上 Node ≥22.5 后重跑（apt install nodejs 或 nvm）"
  fi
  tar -xJf "$TMP/node.tar.xz" -C /usr/local --strip-components=1
  node -v >/dev/null || die "Node 解压后仍不可用"
  node -e 'require("node:sqlite")' >/dev/null 2>&1 || die "这个 Node 不带 node:sqlite（需要 22.5+ 的官方构建）"
  say "Node 装好了：$(node -v)"
fi

# ---------------------------------------------------------------- 2. 取代码
say "获取代码"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

case "$SRC" in
  *.tar.gz|*.tgz)
    curl -fsSL --retry 2 --max-time 300 "$SRC" -o "$WORK/src.tar.gz" || die "代码下载失败：$SRC"
    mkdir -p "$WORK/x" && tar -xzf "$WORK/src.tar.gz" -C "$WORK/x"
    # 两种压缩包都要能解：
    #   GitHub 归档 —— 多一层 sui-cf-<branch>/ 目录
    #   自己打的包 —— apps/ panel/ 直接在根
    SRCDIR=""
    if [ -d "$WORK/x/apps/selfhost" ]; then
      SRCDIR="$WORK/x"
    else
      for d in "$WORK/x"/*/; do
        [ -d "${d}apps/selfhost" ] && { SRCDIR="${d%/}"; break; }
      done
    fi
    [ -n "$SRCDIR" ] || die "压缩包里找不到 apps/selfhost（结构不对：既没有顶层目录也没有直接放 apps/）"
    ;;
  git:*|*.git)
    need git
    git clone --depth 1 "${SRC#git:}" "$WORK/repo" || die "clone 失败：$SRC"
    SRCDIR="$WORK/repo"
    ;;
  *)
    die "--src 只支持 tar.gz 或 git: 前缀；收到：$SRC" ;;
esac

[ -d "$SRCDIR/apps/selfhost" ] || die "代码里找不到 apps/selfhost（--src 指向的仓库不对？）"
dim "源码: $SRCDIR"

# ---------------------------------------------------------------- 3. 用户与目录
if ! id "$SVC_USER" >/dev/null 2>&1; then
  say "创建服务账号 $SVC_USER"
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER" 2>/dev/null \
    || useradd -r -d "$DATA_DIR" -s /sbin/nologin "$SVC_USER"
fi
mkdir -p "$DATA_DIR" "$INSTALL_DIR"

# ---------------------------------------------------------------- 4. 安装到位
if [ -f "$INSTALL_DIR/package.json" ] && [ "$FORCE" -eq 0 ]; then
  say "检测到已安装，更新代码（数据库与配置保留）"
  # 只覆盖代码目录，不碰数据目录
  rm -rf "$INSTALL_DIR/apps" "$INSTALL_DIR/panel" "$INSTALL_DIR/package.json" "$INSTALL_DIR/package-lock.json" 2>/dev/null || true
fi

say "复制文件到 $INSTALL_DIR"
cp -a "$SRCDIR/apps" "$INSTALL_DIR/" 2>/dev/null || true
cp -a "$SRCDIR/panel" "$INSTALL_DIR/" 2>/dev/null || true
[ -f "$SRCDIR/package.json" ] && cp -a "$SRCDIR/package.json" "$INSTALL_DIR/"
[ -f "$SRCDIR/package-lock.json" ] && cp -a "$SRCDIR/package-lock.json" "$INSTALL_DIR/"

# ---------------------------------------------------------------- 5. 依赖
say "安装运行依赖（npm ci --omit=dev）"
cd "$INSTALL_DIR/apps/selfhost"
if [ "$SKIP_DEPS" -eq 1 ] && [ -d node_modules ]; then
  dim "跳过依赖安装（--skip-deps，包里已带 node_modules）"
else
  DEPS_OK=1
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --no-audit --no-fund >/tmp/sui-npm.log 2>&1 || DEPS_OK=0
  fi
  if [ "$DEPS_OK" -eq 0 ] || [ ! -d node_modules ]; then
    npm install --omit=dev --no-audit --no-fund >/tmp/sui-npm.log 2>&1 || DEPS_OK=0
  fi
  if [ "$DEPS_OK" -eq 0 ]; then
    warn "依赖安装失败，npm 的原始输出在 /tmp/sui-npm.log"
    if grep -qE 'EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNREFUSED' /tmp/sui-npm.log 2>/dev/null; then
      warn "看起来是 DNS / 网络问题（解析不了 npm 源）"
      dim "排查：cat /etc/resolv.conf（应为可用的 nameserver）；或换源："
      dim "  npm config set registry https://registry.npmmirror.com && 重跑本脚本"
      dim "纯离线机器：在别处装好 node_modules 一起打包，然后加 --skip-deps"
    fi
    die "依赖没装成，面板起不来"
  fi
fi
chown -R "$SVC_USER:$SVC_USER" "$INSTALL_DIR" "$DATA_DIR"

# ---------------------------------------------------------------- 6. 配置与密钥
ENV_FILE="$INSTALL_DIR/panel.env"
if [ ! -f "$ENV_FILE" ]; then
  say "生成配置与初始密钥"
  JWT=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
  ADMIN_PASS=$(node -e 'console.log(require("crypto").randomBytes(9).toString("base64url"))')
  umask 077
  cat > "$ENV_FILE" <<EOF
SUI_DB=$DATA_DIR/sui.db
PORT=$PORT
JWT_SECRET=$JWT
SUI_DIST=$INSTALL_DIR/panel/frontend-dist
SUI_ADMIN_PASS=$ADMIN_PASS
EOF
  umask 022
  chown "$SVC_USER:$SVC_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  say "已有配置，保留（$ENV_FILE）"
  # shellcheck disable=SC1090
  ADMIN_PASS=$(grep -E '^SUI_ADMIN_PASS=' "$ENV_FILE" | cut -d= -f2- || true)
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# ---------------------------------------------------------------- 6.5 数据库
# 面板启动时若数据库文件不存在会直接退出（server.ts 里是 existsSync 检查），
# 所以首次安装必须自己把表建出来 —— 上游给的是「先导入快照」，那是迁移场景，
# 新装机没有快照可导。
DB_FILE="$SUI_DB"
if [ ! -f "$DB_FILE" ]; then
  say "初始化数据库"
  mkdir -p "$(dirname "$DB_FILE")"
  node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    import { readFileSync } from 'node:fs';
    const db = new DatabaseSync(process.env.DB_FILE);
    db.exec(readFileSync(process.env.SCHEMA, 'utf8'));
    db.close();
  " DB_FILE="$DB_FILE" SCHEMA="$INSTALL_DIR/panel/schema.sql" 2>/dev/null     || DB_FILE="$DB_FILE" SCHEMA="$INSTALL_DIR/panel/schema.sql" node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    import { readFileSync } from 'node:fs';
    const db = new DatabaseSync(process.env.DB_FILE);
    db.exec(readFileSync(process.env.SCHEMA, 'utf8'));
    db.close();
  " || die "建表失败（$INSTALL_DIR/panel/schema.sql 读不到？）"

  # 建初始管理员：schema.sql 里没有默认账号，不建的话登录页永远进不去。
  say "创建初始管理员 admin"
  DB_FILE="$DB_FILE" ADMIN_PASS="$ADMIN_PASS" node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.DB_FILE);
    const pass = process.env.ADMIN_PASS;
    const ITER = 100000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
    const b64 = (b) => Buffer.from(b).toString('base64');
    const hash = 'pbkdf2\$' + ITER + '\$' + b64(salt.buffer) + '\$' + b64(bits);
    db.prepare('INSERT INTO users (username, password_hash, must_change, created_at, session_epoch) VALUES (?,?,?,?,?)')
      .run('admin', hash, 1, Math.floor(Date.now()/1000), 1);
    db.close();
  " || die "创建管理员失败"
  chown "$SVC_USER:$SVC_USER" "$DB_FILE"
else
  dim "数据库已存在，保留（$DB_FILE）"
fi

# ---------------------------------------------------------------- 7. systemd
# 启动方式有讲究，三件事缺一不可：
# 1) 不能用 `node src/server.ts`：Node 的 type-stripping 只支持可擦除语法，
#    d1.ts 里的 constructor parameter properties 会报 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
#    项目本来就用 tsx（见 package.json 的 start）。
# 2) 不能直接调 node_modules/.bin/tsx：那是个 `#!/usr/bin/env node` 的 wrapper，
#    systemd 的 PATH 里通常没有 node（Node 可能装在 /opt/node、/root/.nvm/... 下），
#    结果就是 `/usr/bin/env: 'node': No such file or directory`（127）。
# 3) 用 node 直接跑 tsx 的入口文件，并把 node 所在目录写进 Environment=PATH，
#    这样 wrapper 里的 env node 也能兜住。
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
TSX_CLI="$INSTALL_DIR/apps/selfhost/node_modules/tsx/dist/cli.mjs"
if [ -f "$TSX_CLI" ]; then
  PANEL_EXEC="$NODE_BIN $TSX_CLI src/server.ts"
else
  warn "找不到 tsx 入口（$TSX_CLI），退回 .bin/tsx wrapper"
  PANEL_EXEC="$INSTALL_DIR/apps/selfhost/node_modules/.bin/tsx src/server.ts"
fi

say "写入 systemd 服务"
cat > "/etc/systemd/system/${SVC_NAME}.service" <<EOF
[Unit]
Description=s-ui Cloud panel (self-hosted, ${SVC_NAME})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$INSTALL_DIR/apps/selfhost
EnvironmentFile=$ENV_FILE
Environment=PATH=$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$PANEL_EXEC
Restart=always
RestartSec=3
# 只给它自己的数据目录写权限
ReadWritePaths=$DATA_DIR $INSTALL_DIR
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SVC_NAME" >/dev/null 2>&1 || true
systemctl restart "$SVC_NAME"
sleep 3

if ! systemctl is-active --quiet "$SVC_NAME"; then
  warn "服务没起来，最近日志："
  journalctl -u "$SVC_NAME" -n 20 --no-pager >&2 || true
  die "面板启动失败"
fi

# ---------------------------------------------------------------- 8. 自检
say "自检面板"
OK=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[ "$OK" -eq 1 ] || { journalctl -u "$SVC_NAME" -n 30 --no-pager >&2 || true; die "面板端口 $PORT 无响应"; }
dim "API 正常"

# ---------------------------------------------------------------- 9. 本机节点
if [ "$WITH_AGENT" -eq 1 ]; then
  DL="$INSTALL_DIR/panel/frontend-dist/dl"
  AGENT_BIN=""
  if [ -n "$AGENT_URL" ]; then
    say "下载节点 agent"
    curl -fsSL --retry 2 --max-time 300 "$AGENT_URL" -o /tmp/sui-agent || warn "agent 下载失败，跳过本机节点"
    [ -s /tmp/sui-agent ] && AGENT_BIN=/tmp/sui-agent
  elif [ -d "$DL" ] && ls "$DL"/sui-agent-linux-*.parts >/dev/null 2>&1; then
    say "从面板自带的分片里取 agent"
    NAM="sui-agent-linux-${ARCH}"
    CNT=$(cat "$DL/${NAM}.parts" 2>/dev/null || echo 0)
    if [ "${CNT:-0}" -gt 0 ]; then
      rm -f /tmp/sui-agent.parts
      ok=1
      for i in $(seq 0 $((CNT-1))); do
        idx=$(printf '%02d' "$i")
        curl -fsS --max-time 60 "file://$DL/${NAM}.part-${idx}" >> /tmp/sui-agent.parts 2>/dev/null \
          || { ok=0; break; }
      done
      if [ "$ok" -eq 1 ]; then
        gunzip -c /tmp/sui-agent.parts > /tmp/sui-agent 2>/dev/null && AGENT_BIN=/tmp/sui-agent
      fi
    fi
  fi

  if [ -n "$AGENT_BIN" ]; then
    say "安装本机节点 agent"
    bash "$INSTALL_DIR/apps/selfhost/scripts/install-agent.sh" \
      --panel "http://127.0.0.1:${PORT}" \
      --bin "$AGENT_BIN" 2>&1 | tail -8 || warn "agent 安装失败（面板本身可用，节点可以后再接）"
  else
    warn "没有可用的 agent 二进制 —— 本机节点没装"
    warn "  面板本身已经能用；接入节点走面板里的「添加服务器」，会给你一条命令"
    warn "  想让本机也当节点：带 --agent <二进制URL> 重跑本脚本"
  fi
fi

# ---------------------------------------------------------------- 10. HTTPS（可选）
if [ -n "$DOMAIN" ]; then
  say "配置 HTTPS 反代（$DOMAIN）"
  if [ -f "$INSTALL_DIR/apps/selfhost/scripts/enable-tls.sh" ]; then
    PORT_UP="$PORT" bash "$INSTALL_DIR/apps/selfhost/scripts/enable-tls.sh" "$DOMAIN" 2>&1 | tail -6 \
      || warn "反代配置失败（面板仍在本机 $PORT 可用）"
  else
    warn "找不到 enable-tls.sh，跳过"
  fi
fi

# ---------------------------------------------------------------- 11. 输出
IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
cat <<EOF

$(printf '%s' "$C_OK")安装完成$(printf '%s' "$C_0")

  面板地址   http://${IP:-<本机IP>}:${PORT}
$( [ -n "$DOMAIN" ] && echo "  公网域名   https://${DOMAIN}" )
  配置文件   $ENV_FILE
  数据目录   $DATA_DIR
  服务管理   systemctl {status,restart,stop} ${SVC_NAME}

  管理员账号 admin
  管理员密码 ${ADMIN_PASS:-（见 $ENV_FILE 里的 SUI_ADMIN_PASS）}

  下一步：
    1. 浏览器打开上面的地址并用上面的账号登录
    2. 「服务器」页 → Add Server 接入更多节点（会给你一条命令）
    3. 想换密码：登录后在「管理员」页改

EOF
