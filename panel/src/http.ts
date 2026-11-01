// 面板各处共用的 HTTP 基础设施：会话、统一响应格式、地址与密钥。
// 从 index.ts 抽出来，避免路由模块反向 import 入口（那会成环）。
import { getCookie } from "hono/cookie";
import { COOKIE, isSessionPayload, signJWT, verifyJWT } from "./auth";
import { first, getNode, listNodes, run, type Env, type NodeRow } from "./db";

export interface Session {
  username: string;
  mustChange: boolean;
  uid: number;
}

/** 前端路由守卫读的是 document.cookie 里的 `s-ui`（沿用原版名字）。 */
export const MARKER_COOKIE = "s-ui";

/** JWT 秘钥：优先 env，否则在 D1 meta 里生成一次并复用。 */
export async function secretOf(env: Env): Promise<string> {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  const row = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM meta WHERE key = 'jwt_secret'",
  );
  if (row?.value) return row.value;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  await run(
    env.DB,
    "INSERT INTO meta (key, value) VALUES ('jwt_secret', ?) ON CONFLICT(key) DO NOTHING",
    secret,
  );
  return secret;
}

export async function currentUser(c: any): Promise<Session | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const payload = await verifyJWT(token, await secretOf(c.env));
  // isSessionPayload 会拒掉二次验证票据（otp:1）——那张票只是“密码正确”，不是登录成功。
  if (!isSessionPayload(payload)) return null;
  return {
    username: payload.u,
    uid: Number(payload.uid ?? 0),
    mustChange: payload.mc === true,
  };
}

/** 选中的节点：X-Remote-Server 头优先，缺省落到第一个启用节点。 */
export async function resolveNode(
  db: Env["DB"],
  headerId: string | undefined,
): Promise<NodeRow | null> {
  if (headerId) return await getNode(db, headerId);
  // 前端没指定节点时，每次请求都扫一遍 nodes 表（10 行）。面板轮询很密，
  // 而「第一个启用节点」几乎不变——缓 60 秒；单这一项每天能省下十几万 rows_read。
  const ts = Math.floor(Date.now() / 1000);
  if (!defaultNodeCache || ts - defaultNodeCache.at > 60) {
    const nodes = await listNodes(db);
    defaultNodeCache = { at: ts, node: nodes.find((n) => n.enabled) ?? null };
  }
  return defaultNodeCache.node;
}

let defaultNodeCache: { at: number; node: NodeRow | null } | null = null;

/** s-ui 的响应约定：永远 200 + { success, msg, obj }。 */
export const json = (c: any, obj: unknown, error?: unknown) =>
  c.json({
    success: !error,
    msg: error ? String((error as Error)?.message ?? error) : "",
    obj: obj ?? null,
  });

export const okMsg = (c: any, msg = "") =>
  c.json({ success: true, msg, obj: null });

export function randHex(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function baseUrl(c: any): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return c.env.PANEL_BASE ?? "";
  }
}

/** 重签登录 cookie（改密后用，避免必须重新登录）。 */
export async function refreshSessionCookie(
  c: any,
  user: { username: string; id: number },
) {
  let https = true;
  try {
    https = new URL(c.req.url).protocol === "https:";
  } catch {
    https = true;
  }
  const token = await signJWT(
    { u: user.username, uid: user.id, mc: false },
    await secretOf(c.env),
  );
  const { setCookie } = await import("hono/cookie");
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400,
    secure: https,
  });
}

/**
 * 读请求体：同时支持 JSON 与 form-urlencoded。
 *
 * 前端 axios 把 Content-Type 定成 form-urlencoded，但对象体可能是 JSON 串，
 * Hono 的 parseBody() 只按 Content-Type 解析——两边任一对不上就拿到空对象。
 * 与其猜，不如两种都试。
 */
export async function readBody(c: any): Promise<Record<string, string>> {
  const ct = (c.req.header("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    const j = await c.req.json().catch(() => ({}));
    return (j || {}) as Record<string, string>;
  }
  const f = await c.req.parseBody().catch(() => ({}));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}
