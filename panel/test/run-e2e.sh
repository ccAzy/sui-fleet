#!/usr/bin/env bash
# 一键跑端到端：重建库 → 起本地面板 → 跑 e2e → 停服务。
#
# 为什么要重建库：e2e 会改管理员密码（首次登录强制改密那一段），
# 旧库直接复跑必然卡在 "Invalid login"；残留的 -wal 也会让新库读到旧事务。
set -eu
cd "$(dirname "$0")/.." || exit 1

PORT="${PORT:-8799}"
ROOT="$(cd .. && pwd)"
DB="$PWD/e2e.db"
DIST="$PWD/frontend-dist"

# 按端口杀掉监听进程。
# 原来只有 Windows 分支（netstat -ano 的 $5 是 PID），在 Linux 上 $5 是 "LISTEN"，
# 等于什么都杀不掉 —— 实测上一轮 e2e 的服务会一直占着 8799，污染下一次运行
# （限速用例的计数被上一次的请求占掉，第 57 次就 429）。
cleanup() {
  local pid=""
  if command -v ss >/dev/null 2>&1; then
    pid=$(ss -tlnp 2>/dev/null | grep ":$PORT " | sed -n 's/.*pid=\([0-9]\{1,\}\).*//p' | head -1)
    if [ -n "$pid" ]; then
      kill -9 "$pid" 2>/dev/null || true
      return
    fi
  fi
  pid=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep -E "LISTENING|LISTEN" | awk '{print $NF}' | head -1 || true)
  if [ -n "${pid:-}" ] && [ "$pid" != "LISTEN" ]; then
    taskkill //F //PID "$pid" >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cleanup
sleep 1
rm -f "$DB" "$DB-wal" "$DB-shm"
python3 - "$DB" <<'PY'
import sqlite3, sys, pathlib
db = sys.argv[1]
sql = pathlib.Path("schema.sql").read_text(encoding="utf-8")
con = sqlite3.connect(db)
con.executescript(sql)
con.commit()
print("fresh db ok")
PY

E2E_ENV=(env SUI_DB="$DB" SUI_DIST="$DIST" PORT="$PORT" JWT_SECRET=e2e-secret-0123456789 CRON_SECRET=test-cron-secret)
if command -v setsid >/dev/null 2>&1; then
  # 独立进程组：tsx 会再 fork 一个 node，只 kill npx 包装进程会留下孤儿占着端口
  setsid "${E2E_ENV[@]}" npx tsx "$ROOT/apps/selfhost/src/server.ts" >/tmp/e2e-srv.log 2>&1 &
else
  "${E2E_ENV[@]}" npx tsx "$ROOT/apps/selfhost/src/server.ts" >/tmp/e2e-srv.log 2>&1 &
fi
SRV=$!

for _ in $(seq 1 20); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/health" || true)
  [ "$code" = "200" ] && break
done
if [ "${code:-}" != "200" ]; then
  echo "server did not come up; log:"
  tail -20 /tmp/e2e-srv.log
  exit 1
fi

set +e
PYTHONIOENCODING=utf-8 CRON_SECRET=test-cron-secret python3 test/e2e.py "http://127.0.0.1:$PORT"
RC=$?
set -e
# 先杀整个进程组（setsid 启动时），再按端口兜底，最后才杀包装进程
kill -- -"$SRV" 2>/dev/null || kill "$SRV" 2>/dev/null || true
cleanup
exit "$RC"
