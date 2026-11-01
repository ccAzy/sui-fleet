#!/usr/bin/env bash
# 在「被墙但能出站」的节点上装 Cloudflare 固定隧道（named tunnel）。
#
#   TUNNEL_TOKEN=<token> INGRESS_HOST=rn1-argo.example.com bash install-cloudflared.sh
#
# 前提：
#   1) 已在 Cloudflare 建好 named tunnel，且远端配置 ingress 指向 https://127.0.0.1:2087
#      （originRequest.noTLSVerify=true，因为源站是自签证书）
#   2) 面板里该节点已有 vless+ws 入站，监听 127.0.0.1:2087
#
# 为什么能绕开封锁：cloudflared 是**出站**建连，客户端连的是 Cloudflare 边缘 IP，
# 全程不碰被封的源站 IP。反过来说，域名本身没用——拦的是 IP，不是名字。
set -euo pipefail

TOKEN="${TUNNEL_TOKEN:?需要 TUNNEL_TOKEN（Cloudflare Dashboard → 隧道 → 安装命令里的 --token 值）}"
CF_BIN_SRC="${CF_BIN_SRC:-/tmp/cloudflared}"

if ! command -v cloudflared >/dev/null 2>&1; then
  if [ -x "$CF_BIN_SRC" ]; then
    install -m755 "$CF_BIN_SRC" /usr/local/bin/cloudflared
  else
    echo "未找到 cloudflared 二进制：先从可达机器上把 cloudflared-linux-amd64 放到 $CF_BIN_SRC"
    exit 1
  fi
fi

mkdir -p /etc/cloudflared
umask 077; printf '%s' "$TOKEN" > /etc/cloudflared/token
chmod 600 /etc/cloudflared/token

cat >/etc/systemd/system/cloudflared.service <<'UNIT'
[Unit]
Description=Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/local/bin/cloudflared --no-autoupdate --metrics 127.0.0.1:20241 tunnel run --token-file /etc/cloudflared/token
Restart=always
RestartSec=5s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now cloudflared
sleep 5
echo -n "服务: "; systemctl is-active cloudflared
echo -n "版本: "; cloudflared --version | head -1
