#!/usr/bin/env bash
# 隧道健康探针（v2）
#
# 为什么不再探 /argo：sing-box 对「非 WebSocket 的普通 HTTP 请求」处理不一致——
# 有时回 400，有时直接挂住不回（客户端表现为 000）。实测**真实 WS 代理流量 5/5 全通**，
# 所以那个 400/000 是探测方式的假象，用它会误判并把好好的隧道重启掉。
#
# v2 判据：
#   1) 打一个隧道内不存在的路径，期望 ingress 兜底的 404 —— 证明「边缘 ↔ cloudflared」活着；
#   2) 本机 2087 在监听 —— 证明「cloudflared ↔ sing-box」源站活着。
# 两者都失败才重启 cloudflared。
HOST="${CF_HOST:?}"
LOCAL_PORT="${CF_PORT:-2087}"

probe() { curl -s -o /dev/null -w '%{http_code}' -m 10 "https://$HOST/__cf_probe_$RANDOM" || echo 000; }

code=$(probe)
if [ "$code" != "404" ]; then
  sleep 5
  code=$(probe)
fi

if [ "$code" = "404" ]; then
  # 隧道通；再看源站端口（不通说明是 sing-box 侧的事，重启 cloudflared 没用）
  if ! ss -tln 2>/dev/null | grep -q ":$LOCAL_PORT "; then
    logger -t cf-check "隧道正常但源站 $LOCAL_PORT 未监听（sing-box 侧）"
  fi
  exit 0
fi

logger -t cf-check "隧道探测失败 ($code)，重启 cloudflared"
systemctl restart cloudflared
