// TG 命令机器人：长轮询 getUpdates，只回应白名单里的 chat_id。
// 数据直接读面板 sqlite（本机），不发 HTTP、不需要令牌。
import { DatabaseSync } from "node:sqlite";

const TOKEN = process.env.TG_TOKEN || "";
const ALLOW = String(process.env.TG_CHAT_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DB = process.env.DB || "/opt/sui-panel/data/sui.db";
const API = `https://api.telegram.org/bot${TOKEN}`;
const HOST = process.env.HOSTNAME || "sui";

if (!TOKEN || !ALLOW.length) {
  console.error("缺少 TG_TOKEN / TG_CHAT_ID");
  process.exit(2);
}

const say = async (chat, text) => {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("send fail", e.message);
  }
};

const fmtAgo = (s) =>
  s > 86400
    ? `${Math.floor(s / 86400)}d`
    : s > 3600
      ? `${Math.floor(s / 3600)}h`
      : s > 60
        ? `${Math.floor(s / 60)}m`
        : `${s}s`;
const human = (n) => {
  n = Number(n) || 0;
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)}${u[i]}`;
};

function nodes() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db
    .prepare(
      "SELECT id,name,address,core_state,last_seen,agent_ver,kernel_ver,applied_rev,revision,enabled FROM nodes ORDER BY id",
    )
    .all();
  const now = Math.floor(Date.now() / 1000);
  const traffic = new Map();
  for (const r of db
    .prepare("SELECT node_id,data FROM objects WHERE kind='clients'")
    .all()) {
    try {
      const c = JSON.parse(r.data);
      const cur = traffic.get(r.node_id) || { up: 0, down: 0 };
      cur.up += Number(c.up) || 0;
      cur.down += Number(c.down) || 0;
      traffic.set(r.node_id, cur);
    } catch {
      /* 坏行跳过 */
    }
  }
  db.close();
  return rows.map((r) => ({
    ...r,
    age: now - (r.last_seen || 0),
    ...(traffic.get(r.id) || { up: 0, down: 0 }),
  }));
}

async function status() {
  let panel = "?";
  try {
    const res = await fetch("http://127.0.0.1:8788/health", {
      signal: AbortSignal.timeout(5000),
    });
    panel = res.ok ? "正常" : `HTTP ${res.status}`;
  } catch {
    panel = "不通";
  }
  const ns = nodes();
  const run = ns.filter((n) => n.core_state === "running").length;
  const alive = ns.filter((n) => n.age < 300).length;
  const up = ns.reduce((a, n) => a + n.up, 0),
    down = ns.reduce((a, n) => a + n.down, 0);
  return [
    `<b>${HOST} · 状态</b>`,
    `面板：${panel}`,
    `节点：${ns.length} 台，运行 ${run}，5 分钟内上报 ${alive}`,
    `累计流量：↑ ${human(up)} / ↓ ${human(down)}`,
  ].join("\n");
}

function list() {
  const ns = nodes();
  if (!ns.length) return "没有节点。";
  const lines = ns.map((n) => {
    const flag = n.core_state === "running" ? "🟢" : n.age > 300 ? "🔴" : "🟡";
    return `${flag} <code>${n.id}</code> ${n.name || ""} · ${n.core_state} · ${fmtAgo(n.age)}前`;
  });
  return `<b>节点（${ns.length}）</b>\n` + lines.join("\n");
}

function detail(id) {
  const n = nodes().find((x) => x.id === id || (x.name || "").includes(id));
  if (!n) return `找不到节点：${id}`;
  return [
    `<b>${n.name || n.id}</b>（<code>${n.id}</code>）`,
    `状态：${n.core_state}${n.enabled ? "" : "（已禁用）"}`,
    `地址：${n.address || "-"}`,
    `最后上报：${fmtAgo(n.age)}前`,
    `版本：agent ${n.agent_ver || "-"} / 内核 ${n.kernel_ver || "-"}`,
    `配置：applied ${n.applied_rev} / revision ${n.revision}`,
    `流量：↑ ${human(n.up)} / ↓ ${human(n.down)}`,
  ].join("\n");
}

function top() {
  const ns = nodes()
    .filter((n) => n.up + n.down > 0)
    .sort((a, b) => b.up + b.down - (a.up + a.down))
    .slice(0, 5);
  if (!ns.length) return "还没有流量记录。";
  return (
    "<b>流量 Top 5</b>\n" +
    ns
      .map(
        (n, i) =>
          `${i + 1}. ${n.name || n.id}：↑ ${human(n.up)} / ↓ ${human(n.down)}`,
      )
      .join("\n")
  );
}

const HELP = `<b>可用命令</b>
/status — 面板 + 节点总览
/nodes — 节点列表（含状态与最后上报）
/node &lt;id或名字&gt; — 单台详情
/traffic — 流量 Top 5
/help — 本帮助

只读，不会改动任何配置。`;

async function handle(text, chat) {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const c = cmd.replace(/@\w+$/, "").toLowerCase();
  if (c === "/start" || c === "/help") return say(chat, HELP);
  if (c === "/status" || c === "/s") return say(chat, await status());
  if (c === "/nodes" || c === "/n") return say(chat, list());
  if (c === "/traffic" || c === "/t") return say(chat, top());
  if (c === "/node")
    return say(
      chat,
      rest.length ? detail(rest.join(" ")) : "用法：/node &lt;id或名字&gt;",
    );
  return say(chat, `不认识 ${cmd}。\n\n${HELP}`);
}

let offset = 0;
console.log("bot 启动");
for (;;) {
  try {
    const res = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}`, {
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("getUpdates:", data.description);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const u of data.result || []) {
      offset = u.update_id + 1;
      const msg = u.message || u.edited_message;
      if (!msg || !msg.text) continue;
      const chat = String(msg.chat.id);
      if (!ALLOW.includes(chat)) {
        console.log("拒绝非白名单 chat", chat);
        continue;
      }
      await handle(msg.text, chat);
    }
  } catch (e) {
    console.error("loop:", e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
