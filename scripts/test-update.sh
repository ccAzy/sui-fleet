#!/bin/bash
# 节点自更新验证：mock 面板下发 update_agent 指令，
# 节点下载新二进制 → 校验 sha256 → 原子替换 → 重新执行自己。
#
# 用法： bash scripts/test-update.sh
#   （需要在已构建出节点二进制的环境里跑：先执行 scripts/build-wsl.sh）
set -eu

# 仓库根 = 本脚本所在目录的上一级。以前这里写的是未定义的 $REPO，
# 在 set -e 下不会报错，只会拼出 /agent/dist/... 这种不存在的绝对路径，
# 于是这个「验证最高危升级链路」的脚本从来没真正跑通过。
REPO="$(cd "$(dirname "$0")/.." && pwd)"

# 节点源码目录是 node/（2026-10 由 agent/ 改名）；
# build-wsl.sh 的产物落在仓库根的 dist/，不是 node/dist/。
BIN="$REPO/dist/sui-agent-linux-amd64"
PAYLOAD_SRC="$REPO/panel/test/pull-payload-wsl.json"
MOCK="$REPO/panel/test/mock-panel.py"

for f in "$BIN" "$PAYLOAD_SRC" "$MOCK"; do
  if [ ! -f "$f" ]; then
    echo "缺少必需文件：$f" >&2
    echo "  二进制请先执行： bash scripts/build-wsl.sh" >&2
    exit 1
  fi
done
W="$HOME/agent-update-test"

rm -rf "$W"
mkdir -p "$W/db"
cp "$BIN" "$W/sui-agent"
chmod +x "$W/sui-agent"
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
nohup python3 -m http.server 8898 --bind 127.0.0.1 >http.log 2>&1 &
nohup python3 mock-panel.py payload.json 8899 >mock.log 2>&1 &
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
