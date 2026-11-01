"""本地端到端验证：登录 → 建节点 → 存入站/客户端 → agent pull → report → load/sub。
用法: python test/e2e.py [base_url]
只打印结论性摘要，不打印大段响应。
"""

import base64
import hashlib
import hmac
import http.cookiejar
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
# 面板是「多节点 + 当前节点」模型：不带 X-Remote-Server 的请求落到“第一个启用节点”。
# 前端会把选中的节点存进 localStorage.currentServer 再随请求头发回来，e2e 也要照做，
# 否则建完节点后读到的仍是空库里的默认节点状态。
NSID = ""

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def post(path, form=None, js=None, headers=None, token=None):
    url = BASE + path
    # urllib 里 data=None 会变成 GET；无 body 的 POST 必须给 b""
    data = b""
    hdrs = dict(headers or {})
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
    elif js is not None:
        data = json.dumps(js).encode()
        hdrs["Content-Type"] = "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    if NSID and "X-Remote-Server" not in hdrs and not path.startswith("/agent/"):
        hdrs["X-Remote-Server"] = NSID
    if not url.startswith(("http://", "https://")):
        raise ValueError("only http(s) is allowed: " + url)
    req = urllib.request.Request(url, data=data, headers=hdrs)  # noqa: S310  # noqa: S310  # nosec B310 -- BASE 是本地常量
    with opener.open(req, timeout=15) as r:
        return r.read().decode()


def get(path, token=None, headers=None):
    url = BASE + path
    if not url.startswith(("http://", "https://")):
        raise ValueError("only http(s) is allowed: " + url)
    hdrs = dict(headers or {})
    if token:
        hdrs["Authorization"] = "Bearer " + token
    if NSID and "X-Remote-Server" not in hdrs and not path.startswith("/api/servers"):
        hdrs["X-Remote-Server"] = NSID
    req = urllib.request.Request(  # noqa: S310  # nosec B310
        url, headers=hdrs
    )
    with opener.open(req, timeout=15) as r:
        return r.read().decode()


def j(s):
    return json.loads(s)


fails = []


def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else f"  <- {detail}"))
    if not cond:
        fails.append(name)


# ---- 二次验证（TOTP）所需 ----


def _totp(secret, at=None):
    pad = "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(secret + pad)
    step = int((at or time.time()) // 30)
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    num = struct.unpack(">I", mac[off : off + 4])[0] & 0x7FFFFFFF
    return str(num % 1000000).zfill(6)


# e2e 用的管理员密码：每次跑随机生成，不落真实口令（也避免被当成硬编码凭据扫描出来）。
# 新实例默认 admin/admin 会置 must_change=1，
# 此时除白名单外所有接口都拒绝——所以下面会先把密码改掉再继续。
PASS = "e2e-" + hashlib.sha256(str(time.time()).encode()).hexdigest()[:12]

r = j(post("/api/login", form={"user": "admin", "pass": "admin"}))
check("login", r["success"] is True, r)

# 新实例默认 admin/admin 会置 must_change=1，此时除白名单外所有接口都拒绝。
# e2e 必须先把密码改掉，否则后面第一条写请求就会被挡（这正是之前从没跑通的原因之一）。
if (r.get("obj") or {}).get("must_change"):
    r = j(post("/api/changePass", form={"oldPass": "admin", "newPass": PASS}))
    check("首次登录强制改密", r["success"] is True, r)

# 清掉上一次跑留下的节点，保证每次从干净状态验证
existing = j(get("/api/servers"))["obj"]["servers"]
for srv in existing:
    post("/api/nodes/" + srv["id"] + "/delete", form={})

r = j(post("/api/nodes", form={"name": "HK-01", "address": "1.2.3.4", "remark": "e2e"}))
check("create node", r["success"] and r["obj"].get("token"), r)
nid = r["obj"]["id"]
tok = r["obj"]["token"]
NSID = nid  # 之后的业务请求都显式指向这个节点（与前端行为一致）

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
r = j(
    post(
        "/api/save",
        form={"object": "inbounds", "action": "new", "data": json.dumps(inbound)},
    )
)
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
r = j(
    post(
        "/api/save",
        form={"object": "clients", "action": "new", "data": json.dumps(client)},
    )
)
cl = r["obj"]["clients"][0]
check("save client", cl["name"] == "alice" and len(cl.get("links") or []) == 1, r)
first_link = (cl.get("links") or [{}])[0]
check(
    "link generated",
    isinstance(first_link, dict)
    and str(first_link.get("uri", "")).startswith("vless://"),
    cl.get("links"),
)
check(
    "link shape",
    first_link.get("type") == "local" and first_link.get("remark") == "vless-443",
    str(first_link),
)

pull_raw = post("/agent/pull", js={"revision": 0}, token=tok)
r = j(pull_raw)
PULLED_REV = r["revision"]

# 存一份真实 pull 响应给离线验证用（mock panel 回放它）
with open(
    os.path.join(os.path.dirname(__file__), "pull-payload.json"), "w", encoding="utf-8"
) as f:
    json.dump(r, f, ensure_ascii=False, indent=2)
check("agent pull", r["ok"] and len(r["inbounds"]) == 1 and len(r["clients"]) == 1, r)
check(
    "pull config present",
    isinstance(r.get("config"), dict) and "route" in r["config"],
    str(r.get("config")),
)

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
                "onlines": {
                    "inbound": ["vless-443"],
                    "outbound": [],
                    "user": ["alice"],
                },
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
check(
    "traffic accumulated",
    r["obj"]["clients"][0]["down"] == 2048,
    r["obj"]["clients"][0],
)

r = j(get("/api/status"))
check("status running", r["obj"]["running"] is True and r["obj"]["uptime"] == 3600, r)
kernel = r["obj"].get("kernel") or {}
check("kernel version reported", kernel.get("version") == "v1.13.18", str(kernel))

load_obj = j(get("/api/load"))["obj"]
sub_url = load_obj["subURI"]
check("sub uri has key", "?k=" in sub_url, sub_url)
# subURI 是绝对地址（用的是 PANEL_BASE），直接拿它去请求会打到线上。
# 只取 path+query，拼回本机 BASE——这样本地/线上都能测。
_sp = urllib.parse.urlsplit(sub_url)
SUB_PATH = _sp.path + (("?" + _sp.query) if _sp.query else "")
# 节点级 key 必须带作用域才放行（审计 run-1：去掉 client= 会拿到同节点全部租户凭据），
# 所以这里显式带上 client=，模拟面板下发的“每人一条”链接。
SUB_SCOPED = SUB_PATH + "&client=alice"
sub = get(SUB_SCOPED)
decoded = base64.b64decode(sub).decode()
check("subscription", decoded.startswith("vless://"), decoded[:80])

# 不带作用域一律 403 —— 这是本次收紧的核心行为，回归时必须先看这一条
try:
    get(SUB_PATH)
    _unscoped = 200
except urllib.error.HTTPError as e:
    _unscoped = e.code
check("节点级订阅链接无作用域被拒", _unscoped == 403, str(_unscoped))

# ---- 配额语义：延迟启动 / 超量停用 / 周期重置 ----
GiB = 1024**3


def new_client(payload):
    return j(
        post(
            "/api/save",
            form={"object": "clients", "action": "new", "data": json.dumps(payload)},
        )
    )


base_client = {
    "enable": True,
    "config": {"vless": {"uuid": "22222222-3333-4444-5555-666666666666"}},
    "inbounds": [1],
    "volume": 0,
    "expiry": 0,
    "up": 0,
    "down": 0,
    "desc": "",
    "group": "",
}

# 延迟启动：还没跑过流量时不该开始计时
r = new_client(
    {
        **base_client,
        "name": "bob",
        "delayStart": True,
        "autoReset": False,
        "resetDays": 30,
    }
)
check("delay client created", r["success"], r)

# 超量：1KB 配额但已用 2KB
r = new_client({**base_client, "name": "carol", "volume": 1000, "up": 2000})
check("over-quota client created", r["success"], r)

# 周期重置：nextReset 已过期
r = new_client(
    {
        **base_client,
        "name": "dave",
        "autoReset": True,
        "resetDays": 30,
        "nextReset": 1,
        "up": 500,
        "down": 500,
    }
)
check("auto-reset client created", r["success"], r)

# /__cron 现在需要 X-Cron-Secret（fail closed）；测试里用环境变量给的值
CRON = os.environ.get("CRON_SECRET", "test-cron-secret")
get("/__cron", headers={"X-Cron-Secret": CRON})  # 触发一次巡检

clients_now = {c["name"]: c for c in j(get("/api/clients"))["obj"]["clients"]}
bob = clients_now.get("bob", {})
check(
    "delayStart 无流量时不启动计时",
    bob.get("delayStart") is True and not bob.get("expiry"),
    str(bob),
)

carol = clients_now.get("carol", {})
check("超量客户端被停用", carol.get("enable") is False, str(carol))

dave = clients_now.get("dave", {})
check(
    "周期重置清零并累加",
    dave.get("up") == 0 and dave.get("down") == 0 and dave.get("totalUp") == 500,
    str(dave),
)

# 新建客户端会让 revision 前进，更新链路断言前先同步一次基线
PULLED_REV = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))["revision"]

# ---- 节点更新指令链路 ----
# sha256 现在是强制的 64 位 hex（自更新链是权限最高的一条，不允许“填了才校验”）
FAKE_SHA = "a" * 64
post(
    "/api/release",
    form={
        "url": "https://example.com/sui-agent",
        "sha256": FAKE_SHA,
        "version": "9.9.9",
    },
)
# 顺带验证新加的校验真的生效：缺 sha256 / 非 https 都必须被拒
bad1 = j(post("/api/release", form={"url": "https://example.com/x", "version": "1"}))
check("release 拒绝缺 sha256", bad1["success"] is False, bad1)
bad2 = j(post("/api/release", form={"url": "http://example.com/x", "sha256": FAKE_SHA}))
check("release 拒绝非 https", bad2["success"] is False, bad2)
# 恢复成可用的更新源（上面两条被拒，配置应保持不变）
post(
    "/api/release",
    form={
        "url": "https://example.com/sui-agent",
        "sha256": FAKE_SHA,
        "version": "9.9.9",
    },
)
rel = j(get("/api/release"))["obj"]
check("release saved", rel["url"].endswith("/sui-agent"), rel)

r = j(post("/api/updateAgent", form={}))
check("enqueue update", r["success"] is True, r)

pull2 = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))
cmds = pull2.get("commands") or []
check(
    "agent receives update command",
    len(cmds) == 1
    and cmds[0]["kind"] == "update_agent"
    and cmds[0]["payload"]["version"] == "9.9.9",
    str(cmds),
)

pull3 = j(post("/agent/pull", js={"revision": PULLED_REV}, token=tok))
check("command delivered once", pull3.get("unchanged") is True, pull3)

# ---- 数据库统计 / 流量时序 / 变更日志（前端三个弹窗依赖） ----
db = j(get("/api/status?r=db"))["obj"].get("db") or {}
check(
    "数据库统计",
    int(db.get("clients", 0)) >= 1 and int(db.get("inbounds", 0)) >= 1,
    str(db),
)
check("客户端累计流量", int(db.get("clientDown", 0)) >= 2048, str(db))

series = j(get("/api/stats?resource=user&tag=alice&limit=24"))["obj"]
check(
    "流量时序结构",
    len(series) == 2
    and all({"dateTime", "direction", "traffic"} <= set(x) for x in series),
    str(series[:1]),
)

changes = j(get("/api/changes?k=0&c=5"))["obj"]
check(
    "变更日志字段",
    len(changes) > 0 and {"dateTime", "key", "action", "obj"} <= set(changes[0]),
    str(changes[:1]),
)

# ---- Clash 订阅 ----
clash_txt = get(SUB_SCOPED + "&type=clash")
check(
    "clash 订阅",
    "proxies:" in clash_txt
    and "type: vless" in clash_txt
    and "MATCH,PROXY" in clash_txt,
    clash_txt[:120],
)

# ---- sing-box JSON 订阅 ----
sb = j(get(SUB_SCOPED + "&type=singbox"))
check(
    "sing-box 订阅",
    isinstance(sb, list)
    and len(sb) >= 1
    and sb[0].get("type") == "vless"
    and sb[0].get("server_port") == 443,
    str(sb[:1]),
)

# ---- 备份 / 恢复 ----
bundle = j(get("/api/getdb?exclude=stats"))
check(
    "备份导出",
    bundle.get("kind") == "sui-cf-backup"
    and len(bundle.get("tables", {}).get("nodes", [])) >= 1,
    str(list(bundle.get("tables", {}).keys())),
)
imp = j(post("/api/importdb", js=bundle))
check(
    "备份导入", imp.get("success") is True and imp["obj"]["imported"]["nodes"] >= 1, imp
)

# ---- 批量指令 ----
bulk = j(post("/api/nodes/all/command", form={"kind": "restart_core"}))
check("批量重启下发", bulk.get("success") is True and bulk["obj"]["queued"] >= 1, bulk)

try:
    bad = get("/sub/" + nid)
    check("sub without key is rejected", bad.strip() in ("", "forbidden"), bad[:60])
except urllib.error.HTTPError as e:  # noqa: S310 -- 403 是预期结果
    check("sub without key is rejected", e.code == 403, str(e.code))

# ---- 二次验证：绑定 → 登录要码 → 防重放 → 恢复码 → 关闭 ----
st = j(get("/api/otp/status"))
check("2fa 初始关闭", (st.get("obj") or {}).get("on") is False, st)

r = j(post("/api/otp/setup"))
secret = r["obj"]["secret"]
check("2fa 生成密钥", len(secret) == 32, r)

r = j(
    post(
        "/api/otp/enable",
        form={"code": "000000" if _totp(secret) != "000000" else "111111"},
    )
)
check("2fa 错码不能启用", r["success"] is False, r)

r = j(post("/api/otp/enable", form={"code": _totp(secret)}))
check("2fa 正确码启用", r["success"] is True, r)
codes = (r.get("obj") or {}).get("recovery") or []
check("2fa 发放 10 个恢复码", len(codes) == 10, str(len(codes)))

get("/api/logout")
cj.clear()
r = j(post("/api/login", form={"user": "admin", "pass": PASS}))
obj = r.get("obj") or {}
check("2fa 登录要码", obj.get("need_otp") is True and bool(obj.get("ticket")), r)
ticket = obj.get("ticket", "")

r = j(post("/api/login/otp", form={"ticket": ticket, "code": "000000"}))
check("2fa 登录错码被拒", r["success"] is False, r)

code = _totp(secret)
r = j(post("/api/login/otp", form={"ticket": ticket, "code": code}))
check("2fa 登录放行", r["success"] is True, r)

# 防重放：同一 30 秒窗口内同一个码不能再用
get("/api/logout")
cj.clear()
t2 = j(post("/api/login", form={"user": "admin", "pass": PASS}))["obj"]["ticket"]
r = j(post("/api/login/otp", form={"ticket": t2, "code": code}))
check("2fa 同一码重放被拒", r["success"] is False, r)

# 恢复码：可用一次，且用掉即减少
r = j(post("/api/login/otp", form={"ticket": t2, "code": codes[0]}))
check("2fa 恢复码可用", r["success"] is True, r)
st = j(get("/api/otp/status"))
check("2fa 恢复码已消耗", (st.get("obj") or {}).get("recovery_left") == 9, st)

# 关闭（用恢复码，模拟手机丢失）
r = j(post("/api/otp/disable", form={"code": codes[1]}))
check("2fa 可用恢复码关闭", r["success"] is True, r)
st = j(get("/api/otp/status"))
check("2fa 关闭后为 off", (st.get("obj") or {}).get("on") is False, st)


# ---- 审计 run-1 修复的回归断言 ----
# 这些断言针对「授权粒度画错」这一类问题：端点级白名单、节点级订阅 key、
# 导入通道绕过在线校验。任何一条回归都会重新打开它们。


def status_of(path, token=None):
    """返回 HTTP 状态码（get 对 4xx/5xx 会抛 HTTPError）。"""
    try:
        get(path, token=token)
        return 200
    except urllib.error.HTTPError as e:
        return e.code


def link_count(body):
    try:
        plain = base64.b64decode(body + "==" * 2).decode("utf-8", "replace")
    except Exception:
        plain = body
    return plain.count("://")


# A) 只读令牌读到的对象必须脱敏（原本 4/4 直接给出私钥与密码）
ep = {
    "type": "wireguard",
    "tag": "wg-e2e",
    "private_key": "E2E-PRIVATE-KEY-SHOULD-NOT-LEAK",
    "address": ["10.9.9.2/32"],
}
j(
    post(
        "/api/save",
        form={"object": "endpoints", "action": "new", "data": json.dumps(ep)},
    )
)
mon = j(post("/api/addToken", form={"desc": "e2e-monitor", "expiry": "0"}))["obj"]
raw = get("/api/endpoints", token=mon)
d = j(raw)
txt = json.dumps(d, ensure_ascii=False)
check(
    "只读令牌读 endpoints 不含明文私钥",
    "E2E-PRIVATE-KEY-SHOULD-NOT-LEAK" not in txt,
    txt[:200],
)
_obj = d.get("obj") or {}
check(
    "只读令牌读 endpoints 保留结构（字段被标记而非删除）",
    isinstance(_obj.get("endpoints"), list) and "redacted" in txt,
    txt[:200],
)

# /api/inbounds 有独立 handler（要先拼 users 名字），它注册在循环之前会先返回 ——
# 脱敏必须在那里面做，否则只读令牌仍能读到入站密码。
ss_in = {
    "type": "shadowsocks",
    "tag": "ss-e2e",
    "listen": "127.0.0.1",
    "listen_port": 8388,
    "method": "aes-256-gcm",
    "password": "E2E-INBOUND-PASSWORD-LEAK",
    "users": [],
}
j(post("/api/save", form={"object": "inbounds", "action": "new", "data": json.dumps(ss_in)}))
raw_in = json.dumps(j(get("/api/inbounds", token=mon)), ensure_ascii=False)
check(
    "只读令牌读 inbounds 不含明文密码（独立 handler 也要脱敏）",
    "E2E-INBOUND-PASSWORD-LEAK" not in raw_in,
    raw_in[:200],
)

# /api/status 不能把 logs / onlines 带给令牌身份（它们本身不在白名单）
raw_st = json.dumps(j(get("/api/status", token=mon)), ensure_ascii=False)
check(
    "只读令牌读 status 不含 logs/onlines",
    ('"logs"' not in raw_st) and ('"onlines"' not in raw_st),
    raw_st[:200],
)

# B) 订阅链接必须自带作用域：去掉 client 不能再拿到同节点全部租户
load = j(get("/api/load"))
sub_uri = (load.get("obj") or {}).get("subURI") or ""
qs = urllib.parse.parse_qs(urllib.parse.urlparse(sub_uri).query)
node_id = sub_uri.split("/sub/")[-1].split("?")[0] if "/sub/" in sub_uri else ""
sub_key = (qs.get("k") or [""])[0]
clients = (j(get("/api/clients")).get("obj") or {}).get("clients") or []
alice = next((c for c in clients if c.get("name") == "alice"), {})
check("能取到节点级 sub_key 与客户端", bool(node_id and sub_key and alice), sub_uri)

check(
    "不带作用域的订阅链接被拒（403）",
    status_of("/sub/" + node_id + "?k=" + sub_key) == 403,
)
n_filtered = link_count(get("/sub/" + node_id + "?k=" + sub_key + "&client=alice"))
check("带 client= 只返回该客户端", n_filtered == 1, str(n_filtered))
tok = str(alice.get("sub_token") or "")
check("客户端已分配 sub_token", bool(tok), str(list(alice.keys())[:8]))
n_token = link_count(get("/sub/" + node_id + "?t=" + tok))
check("用 ?t=<sub_token> 等价于该客户端", n_token == 1, str(n_token))

# D) 改密必须吊销此前签发的一切会话。
#    原实现是无状态 JWT，currentUser 只验签名与 exp，改密后旧 cookie 仍可用满 24 小时，
#    而且还能继续签发新 token —— 改密对已泄露的会话等于没有止损。
cj2 = http.cookiejar.CookieJar()
op2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj2))


def op_call(op, path, form=None):
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    hdrs = (
        {"Content-Type": "application/x-www-form-urlencoded"}
        if form is not None
        else {}
    )
    # noqa: S310  # nosec B310 -- BASE 是本地常量，只做 http(s) 端到端测试
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs)  # noqa: S310  # nosec B310
    try:
        with op.open(req, timeout=15) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


_s, _b = op_call(op2, "/api/login", {"user": "admin", "pass": PASS})
check("第二会话登录成功", '"success":true' in _b.replace(" ", ""), _b[:120])
_s, _b = op_call(op2, "/api/servers")
check("第二会话改密前可用", '"success":true' in _b.replace(" ", ""), _b[:160])

NEWPASS = PASS + "-rot"
r = j(post("/api/changePass", form={"oldPass": PASS, "newPass": NEWPASS}))
check("改密成功", r.get("success") is True, r)

_s, _b = op_call(op2, "/api/servers")
_stale_ok = '"success":true' in _b.replace(" ", "")
check("改密后旧会话立即失效", not _stale_ok, _b[:160])

r = j(get("/api/servers"))
check("当前会话改密后仍可用（已补签新代次）", r.get("success") is True, str(r)[:120])

# E) 登出必须真的吊销，而不是只删 cookie
r = j(post("/api/changePass", form={"oldPass": NEWPASS, "newPass": "abc"}))
check("弱密码（<8 位）被拒", r.get("success") is False, str(r)[:120])

# getdb 的响应体是整库凭据，不能被任何中间层缓存
req = urllib.request.Request(BASE + "/api/getdb")  # noqa: S310  # nosec B310
with opener.open(req, timeout=20) as resp:
    cc = resp.headers.get("Cache-Control", "")
    resp.read()
check("getdb 带 no-store", "no-store" in cc.lower(), cc)

cj3 = http.cookiejar.CookieJar()
op3 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj3))
_s, _b = op_call(op3, "/api/login", {"user": "admin", "pass": NEWPASS})
check("第三会话登录成功", '"success":true' in _b.replace(" ", ""), _b[:120])
op_call(op3, "/api/logout", {})
_s, _b = op_call(op3, "/api/servers")
check(
    "登出后旧 cookie 失效（不只是删客户端 cookie）",
    '"success":true' not in _b.replace(" ", ""),
    _b[:160],
)

# 登出提升了会话代次，主会话也一起失效 —— 重新登录继续后面的用例
cj.clear()
r = j(post("/api/login", form={"user": "admin", "pass": NEWPASS}))
check("登出后重新登录可用", r.get("success") is True, str(r)[:120])

# C) 导入通道不能绕过在线校验：meta 重复键必须被整个拒绝
dup = {
    "tables": {
        "nodes": [
            {
                "id": "zz",
                "name": "dup",
                "token_hash": "x",
                "address": "203.0.113.9",
                "sub_key": "k",
                "remark": "",
                "enabled": 1,
                "revision": 1,
                "created_at": 1,
                "updated_at": 1,
            }
        ],
        "users": [
            {
                "id": 1,
                "username": "admin",
                "password_hash": "pbkdf2$10000$AA$BB",
                "must_change": 0,
                "created_at": 1,
            }
        ],
        "meta": [
            {"key": "agg_key", "value": "aaaaaaaaaaaaaaaa"},
            {"key": "agg_key", "value": "bbbbbbbbbbbbbbbb"},
        ],
    }
}
r = j(post("/api/importdb", form={"data": json.dumps(dup)}))
check("重复 meta 键的导入被拒", r.get("success") is False, r)

print()
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(0 if not fails else 1)
