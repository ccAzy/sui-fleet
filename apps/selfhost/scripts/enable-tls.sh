#!/usr/bin/env bash
# 在面板主机上给 443 装上 TLS 反代（Caddy），把 https://<域名> 转到本机 127.0.0.1:8788。
#
#   bash enable-tls.sh panel.example.org
#
# 为什么用自签证书：Cloudflare 侧该 zone 的 SSL 模式是 Full（非 strict），
# 边缘到源站允许自签；这样不依赖 ACME、不需要把域名先指过来、也不会因为续期失败把面板搞挂。
# 如果你更想用 Cloudflare Origin Certificate，把这个脚本换掉即可，逻辑不变。
set -euo pipefail
DOMAIN="${1:?用法: enable-tls.sh <域名>}"
PORT="${PORT:-8788}"            # 面板本身监听的本机端口
LISTEN_PORT="${LISTEN_PORT:-443}"  # 对外 TLS 端口（443 被占时用 8443 + Cloudflare Origin Rule）
TLS_DIR="${TLS_DIR:-/opt/sui-panel/tls}"
CADDY_DIR=/opt/caddy

say() { printf '  %s\n' "$1"; }

# 1) Caddy（单文件，不碰系统包管理器）
if [ ! -x "$CADDY_DIR/caddy" ]; then
  say "下载 Caddy"
  mkdir -p "$CADDY_DIR"
  curl -fsSL --retry 3 -o /tmp/caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_amd64.tar.gz"
  tar xzf /tmp/caddy.tar.gz -C /tmp caddy
  install -m755 /tmp/caddy "$CADDY_DIR/caddy"
  rm -f /tmp/caddy /tmp/caddy.tar.gz
fi
say "Caddy $("$CADDY_DIR/caddy" version | head -1)"

# 2) 自签证书（10 年，含 SAN）
mkdir -p "$TLS_DIR"
if [ ! -f "$TLS_DIR/fullchain.pem" ]; then
  say "生成自签证书（CN=$DOMAIN）"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$TLS_DIR/privkey.pem" -out "$TLS_DIR/fullchain.pem" \
    -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" >/dev/null 2>&1
  chmod 600 "$TLS_DIR/privkey.pem"
fi
say "证书到期: $(openssl x509 -enddate -noout -in "$TLS_DIR/fullchain.pem" | cut -d= -f2)"

# 3) Caddyfile + 服务
# 只写一个站点块，端口显式写出来：写裸域名会让 Caddy 默认抢 443，
# 而这台机器的 443 可能已经被别的服务（例如 beszel 的 caddy 容器）占用。
cat > /etc/caddy/Caddyfile <<CADDY
{
  admin off
  auto_https off
}
https://$DOMAIN:$LISTEN_PORT {
  tls $TLS_DIR/fullchain.pem $TLS_DIR/privkey.pem
  reverse_proxy 127.0.0.1:$PORT
}
CADDY

cat > /etc/systemd/system/caddy.service <<UNIT
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

say "自检"
systemctl is-active caddy >/dev/null && say "caddy: active" || { journalctl -u caddy -n 10 --no-pager; exit 1; }
if curl -fsSk --resolve "$DOMAIN:$LISTEN_PORT:127.0.0.1" "https://$DOMAIN:$LISTEN_PORT/health" -m 8 | grep -q '"ok":true'; then
  say "https://$DOMAIN:$LISTEN_PORT/health → ok（本机回环验证）"
else
  say "本机 HTTPS 自检失败"; exit 1
fi
echo
echo "这台已能对外提供 HTTPS。把 DNS 指过来即可（Cloudflare 侧 SSL 模式 Full 即可，无需改证书）。"
