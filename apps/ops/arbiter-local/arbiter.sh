#!/bin/bash
# 本地仲裁者：替代已删除的 Cloudflare Worker（sui-arbiter）。
# 每 2 分钟探一次主控健康；连续失败达到阈值且过了冷却，就切到顺位下一台。
# DRY_RUN=1 时只记录"本应切换"，不碰 DNS、不推进代次（默认，与原 Worker 行为一致）。
set -u
STATE=/opt/sui-arbiter/state.env
LOG_TAG=sui-arbiter
PROBE="https://sui.example.com/health"
ORDER="hk,jp"
declare -A IPS=( [hk]="192.0.2.10" [jp]="85.121.122.96" )
THRESHOLD=3
COOLDOWN=600
DRY_RUN="${DRY_RUN:-1}"
OPS_TOKEN_FILE=/opt/sui-arbiter/ops_token
ZONE_ID="69cdbbbcfd895b665caf28113c142dd5"
RECORD="sui.example.com"
CF_TOKEN_FILE=/opt/sui-arbiter/cf_token

[ -f "$STATE" ] || printf "failures=0\nlast_switch=0\nprimary=hk\n" > "$STATE"
# shellcheck disable=SC1090  # 状态文件由本脚本写成 key=value，直接 source
. "$STATE"
now=$(date +%s)

if curl -fsS --max-time 8 "$PROBE" >/dev/null 2>&1; then
  if [ "$failures" != "0" ]; then
    logger -t "$LOG_TAG" "主控恢复，失败计数清零（此前 $failures 次）"
  fi
  failures=0
else
  failures=$((failures + 1))
fi

if [ "$failures" -ge "$THRESHOLD" ] && [ $((now - last_switch)) -ge "$COOLDOWN" ]; then
  # 顺位表里取当前主控之后的第一台
  next=""
  hit=0
  IFS=',' read -ra arr <<< "$ORDER"
  for n in "${arr[@]}"; do
    if [ "$hit" = "1" ]; then next="$n"; break; fi
    [ "$n" = "$primary" ] && hit=1
  done
  [ -z "$next" ] && next="${arr[0]}"

  if [ "$next" = "$primary" ]; then
    logger -t "$LOG_TAG" "顺位表里没有其他备选，维持 $primary"
  elif [ "$DRY_RUN" = "1" ]; then
    logger -t "$LOG_TAG" "DRY-RUN：本应切到 $next（IP ${IPS[$next]}），不改 DNS、不推进代次"
  else
    ok=0
    if [ -f "$CF_TOKEN_FILE" ] && [ -f "$OPS_TOKEN_FILE" ]; then
      ip="${IPS[$next]}"
      resp=$(curl -fsS --max-time 15 -X PATCH \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$RECORD&type=A" \
        -H "Authorization: Bearer $(cat "$CF_TOKEN_FILE")" \
        -H "Content-Type: application/json" 2>/dev/null) || resp=""
      rid=$(printf '%s' "$resp" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4)
      if [ -n "$rid" ]; then
        curl -fsS --max-time 15 -X PATCH \
          "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$rid" \
          -H "Authorization: Bearer $(cat "$CF_TOKEN_FILE")" \
          -H "Content-Type: application/json" \
          --data "{\"content\":\"$ip\"}" >/dev/null 2>&1 && ok=1
      fi
      if [ "$ok" = "1" ]; then
        curl -fsS --max-time 10 -X POST \
          "https://sui.example.com/api/arbiter?token=$(cat "$OPS_TOKEN_FILE")" \
          -H "Content-Type: application/json" \
          --data "{\"primary\":\"$next\",\"order\":[\"hk\",\"jp\"],\"reason\":\"probe failed $failures times\"}" >/dev/null 2>&1
        logger -t "$LOG_TAG" "已切到 $next（IP $ip），DNS 已更新"
      else
        logger -t "$LOG_TAG" "切换 $next 失败：DNS 更新未成功"
      fi
    else
      logger -t "$LOG_TAG" "缺少 cf_token / ops_token，无法自动切换（DRY_RUN=0 也无效果）"
    fi
    [ "$ok" = "1" ] && primary="$next" && last_switch=$now && failures=0
  fi
fi

printf "failures=%s\nlast_switch=%s\nprimary=%s\n" "$failures" "$last_switch" "$primary" > "$STATE"
