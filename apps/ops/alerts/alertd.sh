#!/bin/bash
# 面板/节点告警守护：systemd timer 每 2 分钟跑一次。
#
# 为什么直接读库而不是调 API：alertd 就装在主控机上，面板的 sqlite 就在本地。
# 走 HTTP 需要一条只读令牌，令牌本身又会过期/被删；直读数据库没有这层依赖，
# 而且面板已经挂了的时候 HTTP 探活仍然要能报出来（用 127.0.0.1 的 /health）。
#
# 通知渠道从 /etc/sui-alert.env 读，支持三种，可同时配：
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
#   WEBHOOK_URL            （POST JSON: {"text": "..."}）
#   BARK_URL               （Bark：<base>/<key>）
# 一个都没配时只写日志，并在日志里明确标注「渠道未配置」。
set -u

DB="${DB:-/opt/sui-panel/data/sui.db}"
HEALTH="${HEALTH:-http://127.0.0.1:8788/health}"
STATE=/var/lib/sui-alert/state.env
LOG=/var/log/sui-alerts.log
ENVFILE=/etc/sui-alert.env
NODE="/opt/node/bin/node"

OFFLINE_SECONDS="${OFFLINE_SECONDS:-300}"   # 节点失联多久算异常
COOLDOWN="${COOLDOWN:-1800}"                # 同一告警的最短重复间隔
DISK_PCT="${DISK_PCT:-90}"

mkdir -p "$(dirname "$STATE")"
[ -f "$STATE" ] || : > "$STATE"
[ -f "$ENVFILE" ] && . "$ENVFILE"

log() { printf '%s %s\n' "$(date -Is)" "$*" >> "$LOG"; }

send() { # send <级别> <正文>
  local level="$1" text="$2" sent=0
  local msg="[$level] $(hostname) · ${text}"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS --max-time 10 -o /dev/null \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${msg}" >/dev/null 2>&1 && sent=1
  fi
  if [ -n "${BARK_URL:-}" ]; then
    curl -fsS --max-time 10 -o /dev/null \
      "${BARK_URL%/}/$(printf '%s' "$msg" | sed 's/ /%20/g')" >/dev/null 2>&1 && sent=1
  fi
  if [ -n "${WEBHOOK_URL:-}" ]; then
    curl -fsS --max-time 10 -o /dev/null -X POST "$WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      --data "$(printf '{"text":"%s"}' "$(printf '%s' "$msg" | sed 's/"/\\"/g')")" >/dev/null 2>&1 && sent=1
  fi
  if [ "$sent" = "1" ]; then log "SENT  $msg"; else log "LOCAL $msg（未配置通知渠道，只写本文件）"; fi
}

# 同一条告警在冷却窗口内不重复发
fire() { # fire <key> <级别> <正文>
  local key="$1" level="$2" text="$3" now last
  now=$(date +%s)
  last=$(grep -m1 "^${key}=" "$STATE" 2>/dev/null | cut -d= -f2)
  last=${last:-0}
  if [ $((now - last)) -lt "$COOLDOWN" ]; then return; fi
  send "$level" "$text"
  sed -i "/^${key}=/d" "$STATE" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$now" >> "$STATE"
}

# 1) 面板自身
if ! curl -fsS --max-time 7 "$HEALTH" >/dev/null 2>&1; then
  fire panel_down CRIT "面板 /health 无响应（$HEALTH）"
fi

# 2) 节点：失联 / 内核未运行
if [ -r "$DB" ] && command -v "$NODE" >/dev/null 2>&1; then
  REPORT=$("$NODE" -e '
    const {DatabaseSync}=require("node:sqlite");
    const db=new DatabaseSync(process.argv[1],{readOnly:true});
    const now=Math.floor(Date.now()/1000);
    for (const r of db.prepare("SELECT id,name,core_state,last_seen,enabled FROM nodes").all()) {
      if (!r.enabled) continue;
      const age = r.last_seen > 0 ? now - r.last_seen : 999999;
      console.log([r.id, r.name || r.id, r.core_state, age].join("|"));
    }
  ' "$DB" 2>/dev/null)
  while IFS='|' read -r id name state age; do
    [ -z "${id:-}" ] && continue
    if [ "${age:-0}" -gt "$OFFLINE_SECONDS" ]; then
      fire "node_offline_${id}" CRIT "节点 ${name}（${id}）已失联 ${age}s"
    elif [ "${state:-}" != "running" ]; then
      fire "node_core_${id}" WARN "节点 ${name}（${id}）内核状态=${state}"
    else
      sed -i "/^node_offline_${id}=/d;/^node_core_${id}=/d" "$STATE" 2>/dev/null || true
    fi
  done <<< "$REPORT"
fi

# 2.5) 每日心跳：没有异常时也要能证明"监控还活着"，否则静默既可能是太平也可能是守护死了
HEARTBEAT_HOUR="${HEARTBEAT_HOUR:-9}"
last_hb=$(grep -m1 "^last_heartbeat=" "$STATE" 2>/dev/null | cut -d= -f2)
last_hb=${last_hb:-0}
now_ts=$(date +%s)
if [ "$(date +%H)" -eq "$HEARTBEAT_HOUR" ] && [ $((now_ts - last_hb)) -gt 72000 ]; then
  summary=$(printf '%s' "${REPORT:-}" | awk -F'|' 'NF>=4{n++; if($3=="running") r++} END{printf "%d 个启用节点，%d 个运行中", n+0, r+0}')
  send INFO "每日心跳：面板正常，${summary}"
  sed -i "/^last_heartbeat=/d" "$STATE" 2>/dev/null || true
  echo "last_heartbeat=$now_ts" >> "$STATE"
fi

# 3) 磁盘
pct=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "${pct:-}" ] && [ "$pct" -ge "$DISK_PCT" ]; then
  fire disk_root CRIT "根分区已用 ${pct}%"
fi
