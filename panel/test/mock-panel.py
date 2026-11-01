"""离线验证用 mock 面板：把真实 Worker 的 /agent/pull 响应回放给节点侧 agent。

用途：在无法让 WSL 连到 Windows 上的 wrangler dev 时，验证 agent 的
"解析 → 落库 → 起内核 → 上报" 这条链路。协议字段与 panel/src/agent.ts 完全一致。

用法:
    python3 mock-panel.py payload.json [port]
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PAYLOAD_PATH = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8899

with open(PAYLOAD_PATH, encoding="utf-8") as f:
    PAYLOAD = json.load(f)

state = {"pulled": 0, "reports": []}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            req = {}

        if self.path == "/agent/pull":
            state["pulled"] += 1
            if state["pulled"] > 1 and req.get("revision") == PAYLOAD.get("revision"):
                return self._json(
                    200,
                    {
                        "ok": True,
                        "unchanged": True,
                        "revision": PAYLOAD.get("revision"),
                    },
                )
            return self._json(200, PAYLOAD)

        if self.path == "/agent/report":
            state["reports"].append(req)
            with open("report.json", "w", encoding="utf-8") as f:
                json.dump(req, f, ensure_ascii=False, indent=2)
            print(
                f"[report] core={req.get('core_state')} rev={req.get('revision_applied')} "
                f"traffic={len(req.get('traffic') or [])} onlines={(req.get('status') or {}).get('onlines')}",
                flush=True,
            )
            return self._json(200, {"ok": True, "pending_commands": 0})

        return self._json(404, {"ok": False, "error": "not found"})


if __name__ == "__main__":
    print(
        f"mock panel on http://127.0.0.1:{PORT}  payload revision={PAYLOAD.get('revision')}",
        flush=True,
    )
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
