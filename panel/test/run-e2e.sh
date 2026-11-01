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

cleanup() {
  local pid
  pid=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1 || true)
  if [ -n "${pid:-}" ]; then
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

SUI_DB="$DB" SUI_DIST="$DIST" PORT="$PORT" \
  JWT_SECRET=e2e-secret-0123456789 CRON_SECRET=test-cron-secret \
  npx tsx "$ROOT/apps/selfhost/src/server.ts" >/tmp/e2e-srv.log 2>&1 &
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
kill "$SRV" 2>/dev/null || true
exit "$RC"
