#!/usr/bin/env bash
# 给已经装好 Cloudflare 隧道（cloudflared）的节点装「端到端健康探针 + 自动重启」。
#
#   bash install-keepalive.sh nodes.tsv
#
# nodes.tsv 每行三列，制表符或空格分隔：
#   <名字>  <IP或主机>  <隧道入口域名>
#   node-a  203.0.113.11  a-argo.example.com
#
# 源站 IP 为 127.0.0.1 的行表示「就是本机」，不会再 ssh 出去。
#
# 探针判据见同目录 cf-check.sh：不再探 /argo（sing-box 对非 WS 请求有时回 400、
# 有时直接挂住，用它会误判并重启好好的隧道），改成「ingress 兜底 404 + 本机端口在听」。
set -uo pipefail

LIST="${1:?用法: install-keepalive.sh nodes.tsv}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"

[ -f "$HERE/cf-check.sh" ] || {
   echo "缺 $HERE/cf-check.sh"
   exit 1
}

install_local() { # $1=host
   local host="$1"
   install -m755 "$HERE/cf-check.sh" /usr/local/bin/cf-check.sh
   cat >/etc/systemd/system/cf-check.service <<UNIT
[Unit]
Description=Check Cloudflare Tunnel end-to-end health
After=network-online.target cloudflared.service

[Service]
Type=oneshot
Environment=CF_HOST=$host
ExecStart=/usr/local/bin/cf-check.sh
UNIT

   cat >/etc/systemd/system/cf-check.timer <<'UNIT'
[Unit]
Description=Run cf-check every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
UNIT

   systemctl daemon-reload
   systemctl enable --now cf-check.timer >/dev/null 2>&1
   printf '  timer: '
   systemctl is-active cf-check.timer
}

install_remote() { # $1=ip $2=host
   local ip="$1" host="$2"
   scp -q -P "$SSH_PORT" -i "$SSH_KEY" $SSH_OPTS "$HERE/cf-check.sh" "root@$ip:/usr/local/bin/cf-check.sh" || return 1
   # ssh 一定要加 -n：在 while read 循环里它会吃掉循环的 stdin，导致只处理第一台
   ssh -n -p "$SSH_PORT" -i "$SSH_KEY" $SSH_OPTS "root@$ip" \
      "chmod +x /usr/local/bin/cf-check.sh
     cat >/etc/systemd/system/cf-check.service <<'UNIT'
[Unit]
Description=Check Cloudflare Tunnel end-to-end health
After=network-online.target cloudflared.service

[Service]
Type=oneshot
Environment=CF_HOST=$host
ExecStart=/usr/local/bin/cf-check.sh
UNIT
     cat >/etc/systemd/system/cf-check.timer <<'UNIT'
[Unit]
Description=Run cf-check every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
UNIT
     systemctl daemon-reload
     systemctl enable --now cf-check.timer >/dev/null 2>&1
     printf '  timer: '; systemctl is-active cf-check.timer"
}

while read -r name ip host; do
   [ -z "${name:-}" ] && continue
   case "$name" in \#*) continue ;; esac
   printf '== %s (%s) %s\n' "$name" "$ip" "$host"
   if [ "$ip" = "127.0.0.1" ]; then
      install_local "$host"
   else
      install_remote "$ip" "$host" || echo "  失败（SSH 不通或权限不足）"
   fi
done <"$LIST"
