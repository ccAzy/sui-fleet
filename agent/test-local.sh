#!/bin/bash
# 节点侧离线验证：用真实 Worker 的 pull 响应回放给 sui-agent，
# 检查"落库 → 渲染 → 内核起监听 → 上报"整条链路。
# 用法： wsl -d Ubuntu-24.04 bash /mnt/c/.../agent/test-local.sh
set -e
BIN="/mnt/c/Users/user/projects/sui-cf/agent/dist/sui-agent-linux-amd64"
D="/mnt/c/Users/user/projects/sui-cf/panel/test"
W="$HOME/agent-test"
rm -rf "$W"; mkdir -p "$W/db"
cp "$BIN" "$W/sui-agent"; chmod +x "$W/sui-agent"
cp "$D/pull-payload-wsl.json" "$W/payload.json"
cp "$D/mock-panel.py" "$W/mock-panel.py"
cd "$W"
pkill -f mock-panel.py 2>/dev/null || true
sleep 1
nohup python3 mock-panel.py payload.json 8899 > mock.log 2>&1 &
echo $! > mock.pid
sleep 1
echo "==> 启动 agent（25 秒观察窗口，期间检查内核端口）"
( sleep 8; echo "--- 内核监听 ---------------------------------"; ss -ltnp 2>/dev/null | grep -E "18443|9090" || echo "(未发现监听)"; echo "----------------------------------------------" ) &
timeout 25 ./sui-agent agent --panel http://127.0.0.1:8899 --token devtoken --interval 8 2>&1 | head -40
echo "==> mock 收到的上报"
tail -3 mock.log
echo "==> report.json 摘要"
python3 - <<'PY'
import json, os
if os.path.exists("report.json"):
    d = json.load(open("report.json", encoding="utf-8"))
    print("core_state:", d.get("core_state"), "rev:", d.get("revision_applied"))
    print("onlines:", (d.get("status") or {}).get("onlines"))
    print("cpu keys:", list((d.get("status") or {}).keys())[:8])
else:
    print("NO REPORT")
PY
echo "==> 本地数据库表"
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("db/s-ui.db")
for t in ("inbounds", "clients", "settings"):
    try:
        print(t, c.execute(f"select count(*) from {t}").fetchone()[0])
    except Exception as e:
        print(t, "ERR", e)
print("inbound:", c.execute("select id,type,tag from inbounds").fetchall()[:3])
print("inbound.options:", c.execute("select options from inbounds").fetchone())
print("client:", c.execute("select id,name,down from clients").fetchall()[:3])
PY
kill "$(cat mock.pid)" 2>/dev/null || true
