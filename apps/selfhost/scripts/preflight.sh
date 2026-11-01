#!/usr/bin/env bash
# 把任意一台机器"变成可当主控"的前置检查。只读，不改任何东西。
#   bash preflight.sh
set -uo pipefail
ok=0
warn=0
bad=0
say() { printf '  %s %s\n' "$1" "$2"; }
pass() {
  say "OK  " "$1"
  ok=$((ok + 1))
}
warn() {
  say "WARN" "$1"
  warn=$((warn + 1))
}
fail() {
  say "FAIL" "$1"
  bad=$((bad + 1))
}

echo "== 1. 系统 =="
. /etc/os-release 2>/dev/null && pass "系统 ${PRETTY_NAME:-unknown}" || warn "读不到 /etc/os-release"
arch=$(uname -m)
case "$arch" in
x86_64 | amd64 | aarch64 | arm64) pass "架构 $arch" ;;
*) fail "架构 $arch 不在预编译范围" ;;
esac
pass "内存 $(free -m | awk '/Mem:/{print $2}') MB / 可用磁盘 $(df -h / | tail -1 | awk '{print $4}')"

echo "== 2. Node 运行时（需要 ≥22.5，node:sqlite）=="
if command -v node >/dev/null 2>&1; then
  v=$(node -v | sed 's/v//')
  major=${v%%.*}
  if [ "$major" -ge 22 ]; then pass "node $v"; else fail "node $v 太旧，需要 ≥22.5（建议 24.x）"; fi
  if node -e "require('node:sqlite')" 2>/dev/null; then pass "node:sqlite 可用"; else fail "node:sqlite 不可用"; fi
else
  warn "未安装 node（可用官方 tarball 装，不必走 apt）"
fi
command -v npm >/dev/null 2>&1 && pass "npm 可用" || warn "缺少 npm"

echo "== 3. 服务与端口 =="
command -v systemctl >/dev/null 2>&1 && pass "systemd 可用" || fail "没有 systemd"
if ss -tln 2>/dev/null | grep -q ':8788 '; then warn "8788 已被占用（改 PORT 或先停掉）"; else pass "8788 空闲"; fi
if ss -tln 2>/dev/null | grep -q ':443 '; then warn "443 已被占用（证书前置方案要先让位）"; else pass "443 空闲（直连 TLS 时要用）"; fi

echo "== 4. 网络 =="
if curl -fsS --max-time 8 -o /dev/null https://registry.npmjs.org/ 2>/dev/null; then pass "可访问 npm registry"; else warn "npm registry 不通（装依赖会失败，可换镜像）"; fi
if curl -fsS --max-time 8 -o /dev/null https://api.cloudflare.com/client/v4/ 2>/dev/null; then pass "可访问 Cloudflare API"; else warn "Cloudflare API 不通（$0 内部不影响运行，只影响导出）"; fi

echo "== 5. 已有角色 =="
[ -f /etc/sui-agent.env ] && pass "已装节点 agent（可共存）" || warn "未装节点 agent（这台还不参与代理）"
[ -f /etc/sui-panel.env ] && warn "已配置面板环境（可能已是主控/待机）" || pass "尚未配置面板环境"
systemctl is-active sui-panel >/dev/null 2>&1 && warn "sui-panel 已在运行" || pass "sui-panel 未运行"

echo
echo "结论：OK=$ok  WARN=$warn  FAIL=$bad"
[ "$bad" -eq 0 ] && echo "→ 这台可以当主控，缺 Node 就先装 Node。" || echo "→ 先解决 FAIL 项再谈切主。"
