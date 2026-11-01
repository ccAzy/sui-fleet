#!/usr/bin/env bash
# 让「待机机」具备被域名直接访问的能力（Caddy + 同域名证书 + 8443）。
#
#   HOST=jp IP=203.0.113.12 bash push-tls.sh
#
# 为什么需要它：promote.sh 只装到这里 —— 面板在本机 8788 上跑起来。
# 可域名是 https://…:8443 打进来的（Cloudflare Origin Rule 改写端口），
# 待机机没有 Caddy 和证书的话，DNS 一切过去就是 522，谁都登不进来。
#
# 本脚本在「当前主控」上执行，把主控上的 Caddy 二进制与证书推给待机机，
# 证书按域名目录分开存（/opt/sui-panel/tls/<域名>/），两台机器配置一致。
set -euo pipefail

HOST="${HOST:?需要 HOST，例如 HOST=jp}"
IP="${IP:?需要 IP，例如 IP=203.0.113.12}"
DOMAIN="${DOMAIN:-panel.example.com}"
LISTEN_PORT="${LISTEN_PORT:-8443}"
PANEL_PORT="${PANEL_PORT:-8788}"
SSH_PORT="${SSH_PORT:-6688}"
SSH_KEY="${SSH_KEY:-/root/.ssh/exec_ed25519}"
CERT_DIR="/opt/sui-panel/tls/$DOMAIN"

say() { printf '  %s\n' "$1"; }

[ -x /opt/caddy/caddy ] || {
  echo "本机没有 /opt/caddy/caddy，先在主控上装好 TLS 前端"
  exit 1
}

# 证书可能放在 tls/<域名>/ 或 tls/<短名>/（历史原因 hk 上叫 tls/hksui/）。
# 按「哪张证书真的覆盖这个域名」来挑，别赌目录名。
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  found=""
  for d in /opt/sui-panel/tls/*/; do
    [ -f "$d/fullchain.pem" ] || continue
    if openssl x509 -in "$d/fullchain.pem" -noout -checkhost "$DOMAIN" 2>/dev/null | grep -q "does match"; then
      found="${d%/}"
      break
    fi
  done
  [ -n "$found" ] || {
    echo "本机找不到覆盖 $DOMAIN 的证书（/opt/sui-panel/tls/*/）"
    exit 1
  }
  echo "  用证书目录: $found  →  目标目录: $CERT_DIR"
  SRC_CERT="$found"
else
  SRC_CERT="$CERT_DIR"
fi

SSH="ssh -p $SSH_PORT -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"
SCP="scp -P $SSH_PORT -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

say "推 Caddy 二进制与证书 → $HOST"
$SSH "root@$IP" "mkdir -p /opt/caddy $CERT_DIR /etc/caddy"
$SCP -q /opt/caddy/caddy "root@$IP:/opt/caddy/caddy.new"
$SCP -q "$SRC_CERT/fullchain.pem" "$SRC_CERT/privkey.pem" "root@$IP:$CERT_DIR/"

say "配置 Caddyfile 与 systemd"
$SSH "root@$IP" "bash -s" <<REMOTE
set -euo pipefail
mv /opt/caddy/caddy.new /opt/caddy/caddy
chmod 755 /opt/caddy/caddy
chmod 600 $CERT_DIR/privkey.pem

cat >/etc/caddy/Caddyfile <<'CADDY'
{
  admin off
  auto_https off
}
https://$DOMAIN:$LISTEN_PORT {
  tls $CERT_DIR/fullchain.pem $CERT_DIR/privkey.pem
  reverse_proxy 127.0.0.1:$PANEL_PORT
}
CADDY

cat >/etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy TLS front-end for s-ui panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/caddy/caddy run --config /etc/caddy/Caddyfile
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy
sleep 2
systemctl is-active caddy
REMOTE

say "本地自检（走 Host 头，等同于 Cloudflare 打进来的请求）"
$SSH "root@$IP" "curl -s -o /dev/null -w '  https(8443) → %{http_code}\n' -k --resolve $DOMAIN:$LISTEN_PORT:127.0.0.1 https://$DOMAIN:$LISTEN_PORT/health"
echo "完成：$DOMAIN 若解析到 $IP，即可直接登录。"
