#!/bin/bash
# 节点自更新验证：mock 面板下发 update_agent 指令，
# 节点下载新二进制 → 校验 sha256 → 原子替换 → 重新执行自己。
#
# 用法： wsl -d Ubuntu-24.04 bash /mnt/c/.../agent/test-update.sh
set -e

BIN="$REPO/agent/dist/sui-agent-linux-amd64"
PAYLOAD_SRC="$REPO/panel/test/pull-payload-wsl.json"
MOCK="$REPO/panel/test/mock-panel.py"
W="$HOME/agent-update-test"

rm -rf "$W"; mkdir -p "$W/db"
cp "$BIN" "$W/sui-agent"; chmod +x "$W/sui-agent"
cp "$PAYLOAD_SRC" "$W/base.json"
cp "$MOCK" "$W/mock-panel.py"
cd "$W"

# 用同一个二进制当作"新版本"，校验值让它必须一致
SHA=$(sha256sum sui-agent | cut -d' ' -f1)
BEFORE_MTIME=$(stat -c %Y sui-agent)
echo "==> 当前二进制 sha256=${SHA:0:16}... mtime=$BEFORE_MTIME"

# 生成带更新指令的 payload
python3 - "$SHA" <<'PY'
import json, sys
sha = sys.argv[1]
d = json.load(open("base.json", encoding="utf-8"))
d["commands"] = [{
    "id": 1,
    "kind": "update_agent",
    "payload": {"url": "http://127.0.0.1:8898/sui-agent", "sha256": sha, "version": "test-build"},
}]
json.dump(d, open("payload.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("payload with update_agent ready")
PY

pkill -f "http.server 8898" 2>/dev/null || true
pkill -f mock-panel.py 2>/dev/null || true
sleep 1
nohup python3 -m http.server 8898 --bind 127.0.0.1 > http.log 2>&1 &
nohup python3 mock-panel.py payload.json 8899 > mock.log 2>&1 &
sleep 1

echo "==> 启动 agent（观察到自更新与重启）"
timeout 40 ./sui-agent agent --panel http://127.0.0.1:8899 --token devtoken --interval 6 2>&1 | head -30 &
AG=$!
sleep 22
echo "==> 更新后 mtime"
stat -c %Y sui-agent
echo "==> 下载日志"
tail -3 http.log
echo "==> 回执"
python3 - <<'PY'
import json, os
if os.path.exists("report.json"):
    d = json.load(open("report.json", encoding="utf-8"))
    print("core:", d.get("core_state"), "kernel:", d.get("kernel_version"), "agent:", d.get("agent_version"))
    print("commands:", d.get("commands"))
else:
    print("NO REPORT")
PY
wait $AG 2>/dev/null || true
pkill -f "http.server 8898" 2>/dev/null || true
pkill -f mock-panel.py 2>/dev/null || true
