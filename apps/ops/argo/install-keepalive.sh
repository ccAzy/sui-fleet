#!/usr/bin/env bash
# 在三个 argo 节点上装：真实链路探针 + 保活
set -uo pipefail
for t in "rn1 107.175.234.130 rn1-argo.example.com 22c417b0-4060-4009-ab0b-895904917b48" \
         "NY 96.47.231.197 ny-argo.example.com 2192c1f9-66ff-43ae-86db-d0805807dc44" \
         "US 67.215.233.13 us-argo.example.com cce4004c-a440-44a9-a4ca-a63153a7fe65"; do
  set -- $t
  name=$1; ip=$2; host=$3; uuid=$4
  printf "== %s (%s) %s\n" "$name" "$ip" "$host"
  ssh -p 6688 -i /root/.ssh/exec_ed25519 -o StrictHostKeyChecking=no -o ConnectTimeout=15 root@$ip "HOST=$host bash -s" <<'REMOTE'
set -e
cat >/usr/local/bin/cf-check.sh <<'CHK'
#!/usr/bin/env bash
# 探针判据：不带 WS 升级头请求该路径，正常应回 400/426（说明 边缘→隧道→源站 整条通）。
# 502/530/000 说明隧道断、源站没起或证书不对 → 重启 cloudflared（进程活着但链路死是真实故障模式）。
HOST="${CF_HOST:?}"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "https://$HOST/argo" || echo 000)
case "$code" in
  400|426) exit 0 ;;
esac
sleep 3
code2=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "https://$HOST/argo" || echo 000)
case "$code2" in
  400|426) exit 0 ;;
esac
logger -t cf-check "链路异常 ($code/$code2)，重启 cloudflared"
systemctl restart cloudflared
CHK
chmod +x /usr/local/bin/cf-check.sh

cat >/etc/systemd/system/cf-check.service <<UNIT
[Unit]
Description=Check Cloudflare Tunnel end-to-end health
After=network-online.target cloudflared.service

[Service]
Type=oneshot
Environment=CF_HOST=$HOST
ExecStart=/usr/local/bin/cf-check.sh
UNIT

cat >/etc/systemd/system/cf-check.timer <<UNIT
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
printf '  timer: '; systemctl is-active cf-check.timer
printf '  首次探测: '; systemctl start cf-check.service; systemctl show cf-check.service -p Result --value
REMOTE
done
