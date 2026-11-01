#!/usr/bin/env bash
# 在面板主机上装 TLS 前端（Caddy），把 https://<域名>[:端口] 反代到本机面板。
#
#   LISTEN_PORT=8443 bash enable-tls.sh 'panel.example.org,hksui.example.com'
#
# 为什么用自签证书：Cloudflare 该 zone 的 SSL 模式是 Full（非 strict），边缘到源站允许自签。
# 这样不依赖 ACME、不需要先把域名指过来、也不会因为续期失败把面板搞挂。
# 为什么端口可配：443 可能被别的服务（例如 beszel 的 caddy 容器）占用，
# 这种情况用 8443 + 一条 Cloudflare Origin Rule 把源站端口改写到 8443 即可。
set -euo pipefail

DOMAINS="${1:?用法: enable-tls.sh 域名[,域名2...]}"
PORT="${PORT:-8788}"
LISTEN_PORT="${LISTEN_PORT:-443}"
TLS_DIR="${TLS_DIR:-/opt/sui-panel/tls}"
CADDY_DIR=/opt/caddy

say() { printf '  %s\n' "$1"; }

# 1) Caddy（单文件，不动系统包管理器）
if [ ! -x "$CADDY_DIR/caddy" ]; then
  say "下载 Caddy"
  mkdir -p "$CADDY_DIR"
  curl -fsSL --retry 3 -o /tmp/caddy.tar.gz \
    "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_amd64.tar.gz"
  tar xzf /tmp/caddy.tar.gz -C /tmp caddy
  install -m755 /tmp/caddy "$CADDY_DIR/caddy"
  rm -f /tmp/caddy /tmp/caddy.tar.gz
fi
say "Caddy $("$CADDY_DIR/caddy" version | head -1)"

# 2) 自签证书（10 年，含全部 SAN）
mkdir -p "$TLS_DIR"
if [ ! -f "$TLS_DIR/fullchain.pem" ]; then
  say "生成自签证书（CN=${DOMAINS%%,*}）"
  SAN=""
  for d in ${DOMAINS//,/ }; do SAN="$SAN,DNS:$d"; done
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$TLS_DIR/privkey.pem" -out "$TLS_DIR/fullchain.pem" \
    -subj "/CN=${DOMAINS%%,*}" -addext "subjectAltName=${SAN#,}" >/dev/null 2>&1
  chmod 600 "$TLS_DIR/privkey.pem"
fi
say "证书到期: $(openssl x509 -enddate -noout -in "$TLS_DIR/fullchain.pem" | cut -d= -f2)"

# 3) Caddyfile：一个站点块，地址里显式写端口
ADDRS=""
for d in ${DOMAINS//,/ }; do ADDRS="$ADDRS https://$d:$LISTEN_PORT,"; done
ADDRS=${ADDRS%,}

mkdir -p /etc/caddy
cat >/etc/caddy/Caddyfile <<CADDY
{
  admin off
  auto_https off
}
$ADDRS {
  tls $TLS_DIR/fullchain.pem $TLS_DIR/privkey.pem
  reverse_proxy 127.0.0.1:$PORT
}
CADDY

# 4) systemd
cat >/etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy (s-ui TLS front)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$CADDY_DIR/caddy run --config /etc/caddy/Caddyfile
ExecReload=$CADDY_DIR/caddy reload --config /etc/caddy/Caddyfile
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 4

# 5) 自检
say "自检"
if ! systemctl is-active caddy >/dev/null; then
  journalctl -u caddy -n 10 --no-pager
  exit 1
fi
say "caddy: active"

FIRST=${DOMAINS%%,*}
if curl -fsSk --resolve "$FIRST:$LISTEN_PORT:127.0.0.1" \
    "https://$FIRST:$LISTEN_PORT/health" -m 8 | grep -q '"ok":true'; then
  say "https://$FIRST:$LISTEN_PORT/health → ok（本机回环验证）"
else
  say "本机 HTTPS 自检失败"
  exit 1
fi

echo
echo "这台已能对外提供 HTTPS（监听 $LISTEN_PORT）。"
echo "若 $LISTEN_PORT 不是 443，需要在 Cloudflare 上给这些域名加一条 Origin Rule：源站端口 → $LISTEN_PORT。"
