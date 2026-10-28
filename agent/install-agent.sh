#!/bin/sh
# s-ui agent 节点安装脚本（Linux / systemd）
#
# 用法（root）：
#   ./install-agent.sh --panel https://panel.example.com --token <token> [--bin ./sui-agent]
#
# 做的事：装二进制 → 建独立数据目录 → 写 systemd 服务 → 启动。
# 不动机器上已有的 s-ui 面板（但如果 443/2095 被占，你需要先处理，脚本会提示）。
set -eu

PANEL=""
TOKEN=""
BIN="./sui-agent"
DIR="/opt/sui-agent"
SERVICE="sui-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --bin)   BIN="$2";   shift 2 ;;
    --dir)   DIR="$2";   shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "请用 root 运行" >&2; exit 1; }
[ -n "$PANEL" ] || { echo "缺少 --panel" >&2; exit 1; }
[ -n "$TOKEN" ] || { echo "缺少 --token" >&2; exit 1; }
[ -f "$BIN" ] || { echo "找不到二进制: $BIN" >&2; exit 1; }

echo "==> 检查已有 s-ui 面板"
if systemctl is-active --quiet s-ui 2>/dev/null; then
  echo "检测到本机已有 s-ui 面板在运行。agent 会启动 sing-box 内核，同时跑两者会抢端口。" >&2
  echo "如果这台机器本来就是节点，请先停掉旧面板：systemctl disable --now s-ui" >&2
  echo "确认要继续，重跑并加 --force 之前请先自行处理。" >&2
  exit 1
fi

echo "==> 安装到 $DIR"
mkdir -p "$DIR/bin" "$DIR/db"
install -m 0755 "$BIN" "$DIR/bin/sui-agent"

echo "==> 写入环境变量 /etc/sui-agent.env"
umask 077
cat > /etc/sui-agent.env <<EOF
SUI_AGENT_PANEL=$PANEL
SUI_AGENT_TOKEN=$TOKEN
SUI_DB_FOLDER=$DIR/db
SUI_LOG_LEVEL=info
EOF
chmod 600 /etc/sui-agent.env

echo "==> 写 systemd 服务"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=s-ui node agent (managed by $PANEL)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
EnvironmentFile=/etc/sui-agent.env
Environment=SUI_DB_FOLDER=$DIR/db
ExecStart=$DIR/bin/sui-agent agent --panel \$SUI_AGENT_PANEL --token \$SUI_AGENT_TOKEN --interval 30
Restart=always
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW CAP_SYS_ADMIN

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE"

sleep 3
echo "==> 状态"
systemctl --no-pager --lines=15 status "$SERVICE" || true
echo
echo "完成。查看日志： journalctl -u $SERVICE -f"
echo "卸载： systemctl disable --now $SERVICE && rm -rf $DIR /etc/sui-agent.env /etc/systemd/system/$SERVICE.service"
