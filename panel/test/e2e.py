"""本地端到端验证：登录 → 建节点 → 存入站/客户端 → agent pull → report → load/sub。
用法: python test/e2e.py [base_url]
只打印结论性摘要，不打印大段响应。
"""
import base64
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def post(path, form=None, js=None, headers=None, token=None):
    url = BASE + path
    data = None
    hdrs = dict(headers or {})
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
    elif js is not None:
        data = json.dumps(js).encode()
        hdrs["Content-Type"] = "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    if not url.startswith(("http://", "https://")):
        raise ValueError("only http(s) is allowed: " + url)
    req = urllib.request.Request(url, data=data, headers=hdrs)  # noqa: S310  # noqa: S310  # nosec B310 -- BASE 是本地常量
    with opener.open(req, timeout=15) as r:
        return r.read().decode()


def get(path, token=None):
    url = BASE + path
    if not url.startswith(("http://", "https://")):
        raise ValueError("only http(s) is allowed: " + url)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token} if token else {})  # noqa: S310  # nosec B310
    with opener.open(req, timeout=15) as r:
        return r.read().decode()


def j(s):
    return json.loads(s)


fails = []


def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else f"  <- {detail}"))
    if not cond:
        fails.append(name)


r = j(post("/api/login", form={"user": "admin", "pass": "admin"}))
check("login", r["success"] is True, r)

# 清掉上一次跑留下的节点，保证每次从干净状态验证
existing = j(get("/api/servers"))["obj"]["servers"]
for srv in existing:
    post("/api/nodes/" + srv["id"] + "/delete", form={})

r = j(post("/api/nodes", form={"name": "HK-01", "address": "1.2.3.4", "remark": "e2e"}))
check("create node", r["success"] and r["obj"].get("token"), r)
nid = r["obj"]["id"]
tok = r["obj"]["token"]

inbound = {
    "type": "vless",
    "tag": "vless-443",
    "listen": "127.0.0.1",
    "listen_port": 443,
    "tls_id": 0,
    "addrs": [],
    "out_json": {},
    "transport": {},
    "users": [],
}
r = j(post("/api/save", form={"object": "inbounds", "action": "new", "data": json.dumps(inbound)}))
inb = r["obj"]["inbounds"][0]
check("save inbound", inb["id"] == 1 and inb["tag"] == "vless-443", r)

client = {
    "enable": True,
    "name": "alice",
    "config": {"vless": {"uuid": "11111111-2222-3333-4444-555555555555"}},
    "inbounds": [1],
    "volume": 0,
    "expiry": 0,
    "up": 0,
    "down": 0,
    "desc": "",
    "group": "",
}
r = j(post("/api/save", form={"object": "clients", "action": "new", "data": json.dumps(client)}))
cl = r["obj"]["clients"][0]
check("save client", cl["name"] == "alice" and len(cl.get("links") or []) == 1, r)
first_link = (cl.get("links") or [{}])[0]
check("link generated", isinstance(first_link, dict) and str(first_link.get("uri", "")).startswith("vless://"), cl.get("links"))
check("link shape", first_link.get("type") == "local" and first_link.get("remark") == "vless-443", str(first_link))

pull_raw = post("/agent/pull", js={"revision": 0}, token=tok)
r = j(pull_raw)
PULLED_REV = r["revision"]

# 存一份真实 pull 响应给离线验证用（mock panel 回放它）
with open(os.path.join(os.path.dirname(__file__), "pull-payload.json"), "w", encoding="utf-8") as f:
    json.dump(r, f, ensure_ascii=False, indent=2)
check("agent pull", r["ok"] and len(r["inbounds"]) == 1 and len(r["clients"]) == 1, r)
check("pull config present", isinstance(r.get("config"), dict) and "route" in r["config"], str(r.get("config")))

r = j(
    post(
        "/agent/report",
        js={
            "revision_applied": r["revision"],
            "agent_version": "0.1.0",
            "kernel_version": "v1.13.18",
            "core_state": "running",
            "uptime": 3600,
            "status": {
                "cpu": 12.5,
                "mem": {"total": 8000000000, "used": 2300000000, "usedPercent": 28.7},
                "net": {"recv": 1024, "sent": 2048},
                "tcp_count": 42,
                "onlines": {"inbound": ["vless-443"], "outbound": [], "user": ["alice"]},
            },
            "traffic": [{"tag": "alice", "up": 1000, "down": 2048}],
        },
        token=tok,
    )
)
check("agent report", r["ok"] is True, r)

r = j(get("/agent/pull?x=1", token=tok)) if False else None  # pull 是 POST，下行单独测
r2 = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))
check("pull unchanged after report", r2.get("unchanged") is True, r2)

r = j(get("/api/load"))
check("load full", r["success"] and len(r["obj"]["inbounds"]) == 1, r)
check("traffic accumulated", r["obj"]["clients"][0]["down"] == 2048, r["obj"]["clients"][0])

r = j(get("/api/status"))
check("status running", r["obj"]["running"] is True and r["obj"]["uptime"] == 3600, r)
kernel = r["obj"].get("kernel") or {}
check("kernel version reported", kernel.get("version") == "v1.13.18", str(kernel))

load_obj = j(get("/api/load"))["obj"]
sub_url = load_obj["subURI"]
check("sub uri has key", "?k=" in sub_url, sub_url)
sub = get(sub_url.replace(BASE, ""))
decoded = base64.b64decode(sub).decode()
check("subscription", decoded.startswith("vless://"), decoded[:80])

# ---- 配额语义：延迟启动 / 超量停用 / 周期重置 ----
GiB = 1024 ** 3

def new_client(payload):
    return j(post("/api/save", form={"object": "clients", "action": "new", "data": json.dumps(payload)}))

base_client = {
    "enable": True, "config": {"vless": {"uuid": "22222222-3333-4444-5555-666666666666"}},
    "inbounds": [1], "volume": 0, "expiry": 0, "up": 0, "down": 0, "desc": "", "group": "",
}

# 延迟启动：还没跑过流量时不该开始计时
r = new_client({**base_client, "name": "bob", "delayStart": True, "autoReset": False, "resetDays": 30})
check("delay client created", r["success"], r)

# 超量：1KB 配额但已用 2KB
r = new_client({**base_client, "name": "carol", "volume": 1000, "up": 2000})
check("over-quota client created", r["success"], r)

# 周期重置：nextReset 已过期
r = new_client({**base_client, "name": "dave", "autoReset": True, "resetDays": 30, "nextReset": 1, "up": 500, "down": 500})
check("auto-reset client created", r["success"], r)

get("/__cron")  # 触发一次巡检

clients_now = {c["name"]: c for c in j(get("/api/clients"))["obj"]["clients"]}
bob = clients_now.get("bob", {})
check("delayStart 无流量时不启动计时", bob.get("delayStart") is True and not bob.get("expiry"), str(bob))

carol = clients_now.get("carol", {})
check("超量客户端被停用", carol.get("enable") is False, str(carol))

dave = clients_now.get("dave", {})
check("周期重置清零并累加", dave.get("up") == 0 and dave.get("down") == 0 and dave.get("totalUp") == 500, str(dave))

# 新建客户端会让 revision 前进，更新链路断言前先同步一次基线
PULLED_REV = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))["revision"]

# ---- 节点更新指令链路 ----
post("/api/release", form={"url": "https://example.com/sui-agent", "sha256": "deadbeef", "version": "9.9.9"})
rel = j(get("/api/release"))["obj"]
check("release saved", rel["url"].endswith("/sui-agent"), rel)

r = j(post("/api/updateAgent", form={}))
check("enqueue update", r["success"] is True, r)

pull2 = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))
cmds = pull2.get("commands") or []
check(
    "agent receives update command",
    len(cmds) == 1 and cmds[0]["kind"] == "update_agent" and cmds[0]["payload"]["version"] == "9.9.9",
    str(cmds),
)

pull3 = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))
check("command delivered once", pull3.get("unchanged") is True, pull3)

# ---- Clash 订阅 ----
clash_txt = get(sub_url.replace(BASE, "") + "&type=clash")
check("clash 订阅", "proxies:" in clash_txt and "type: vless" in clash_txt and "MATCH,PROXY" in clash_txt, clash_txt[:120])

# ---- 备份 / 恢复 ----
bundle = j(get("/api/getdb?exclude=stats"))
check(
    "备份导出",
    bundle.get("kind") == "sui-cf-backup" and len(bundle.get("tables", {}).get("nodes", [])) >= 1,
    str(list(bundle.get("tables", {}).keys())),
)
imp = j(post("/api/importdb", js=bundle))
check("备份导入", imp.get("success") is True and imp["obj"]["imported"]["nodes"] >= 1, imp)

# ---- 批量指令 ----
bulk = j(post("/api/nodes/all/command", form={"kind": "restart_core"}))
check("批量重启下发", bulk.get("success") is True and bulk["obj"]["queued"] >= 1, bulk)

try:
    bad = get("/sub/" + nid)
    check("sub without key is rejected", bad.strip() in ("", "forbidden"), bad[:60])
except urllib.error.HTTPError as e:  # noqa: S310 -- 403 是预期结果
    check("sub without key is rejected", e.code == 403, str(e.code))

print()
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(0 if not fails else 1)
