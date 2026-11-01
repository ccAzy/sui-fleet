// 一键接入脚本。Worker 直接吐出 bash，用户在服务器上粘一条命令即可。
//
// 设计约束：
//   - 幂等：重复执行只会覆盖二进制与单元文件，不会重置已有配置；
//   - 不自带大二进制：agent 与 komari 走面板静态分发的 /dl/，机房速度；
//   - 校验：如果 /dl/*.sha256 存在就校验，不存在只告警（上游本来也不保证有）。
export function installScript(panelBase: string): string {
  return `#!/usr/bin/env bash
# s-ui Cloud 节点接入（由 ${panelBase} 生成）
# 用法： bash sui.sh --token <节点令牌> [--komari <探针令牌>]
set -euo pipefail

PANEL="\${PANEL:-${panelBase}}"
TOKEN=""
KOMARI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --token)  TOKEN="\${2:-}"; shift 2 ;;
    --komari) KOMARI="\${2:-}"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TOKEN" ] || { echo "缺少 --token（在面板「添加服务器」里生成）" >&2; exit 2; }

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "不支持的架构: $(uname -m)" >&2; exit 2 ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少依赖: $1" >&2; exit 2; }; }
need curl; need systemctl; need gunzip

# Cloudflare 静态资源单文件上限 25MiB，agent 的 gz 有 33MB，因此按分片发布：
#   <name>.gz.part-00 / .part-01 / ...   +   <name>.gz.parts（分片数）
# 这里把分片拼回整包再解压，sha256 校验的是"拼接后的 .gz"。
fetch_parts() { # fetch_parts <name> <dest>
  local name="$1" dest="$2"
  local count
  count=$(curl -fsSL --max-time 20 "$PANEL/dl/$name.parts" 2>/dev/null || echo "")
  if [ -z "$count" ]; then echo "缺少分片清单：$name.parts" >&2; exit 1; fi
  : > "$dest"
  local i=0
  while [ "$i" -lt "$count" ]; do
    local idx
    idx=$(printf '%02d' "$i")
    curl -fsSL --retry 3 --max-time 300 "$PANEL/dl/$name.part-$idx" -o "$dest.part" || exit 1
    cat "$dest.part" >> "$dest"
    i=$((i + 1))
  done
  rm -f "$dest.part"
  if curl -fsSL --max-time 20 "$PANEL/dl/$name.sha256" -o "$dest.sha256" 2>/dev/null; then
    want=$(cut -d' ' -f1 < "$dest.sha256")
    got=$(sha256sum "$dest" | cut -d' ' -f1)
    [ "$want" = "$got" ] || { echo "校验失败：$name" >&2; exit 1; }
  else
    echo "  提示：$name 没有 .sha256，跳过校验"
  fi
}

echo "==> 下载 agent ($ARCH)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fetch_parts "sui-agent-linux-$ARCH.gz" "$TMP/agent.gz"
gunzip -c "$TMP/agent.gz" > "$TMP/agent"
install -D -m755 "$TMP/agent" /opt/sui-agent/bin/sui-agent

if [ -n "$KOMARI" ]; then
  if fetch_parts "komari-agent-linux-$ARCH.gz" "$TMP/komari.gz" 2>/dev/null; then
    gunzip -c "$TMP/komari.gz" > "$TMP/komari"
    install -D -m755 "$TMP/komari" /opt/komari/agent
    cat > /etc/systemd/system/komari-agent.service <<UNIT
[Unit]
Description=Komari monitoring agent
After=network-online.target

[Service]
ExecStart=/opt/komari/agent -e \${PANEL%/} -t $KOMARI --disable-web-ssh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
    systemctl enable --now komari-agent >/dev/null 2>&1 || true
  else
    echo "  没有 komari 二进制，跳过探针"
  fi
fi

echo "==> 写入配置与单元"
cat > /etc/sui-agent.env <<ENV
SUI_AGENT_PANEL=$PANEL
SUI_AGENT_TOKEN=$TOKEN
ENV
chmod 600 /etc/sui-agent.env

cat > /etc/systemd/system/sui-agent.service <<UNIT
[Unit]
Description=s-ui cloud node agent
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/sui-agent
EnvironmentFile=/etc/sui-agent.env
Environment=SUI_DB_FOLDER=/opt/sui-agent/db
ExecStart=/opt/sui-agent/bin/sui-agent agent --panel $SUI_AGENT_PANEL --token $SUI_AGENT_TOKEN --interval 60
Restart=always
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable sui-agent >/dev/null 2>&1 || true
systemctl restart sui-agent
sleep 6

echo "==> 结果"
echo "  sui-agent = $(systemctl is-active sui-agent)"
journalctl -u sui-agent -n 5 --no-pager | tail -3
echo
echo "回到面板刷新，这台应显示 running。"
`;
}
