// 面板各处共用的 HTTP 基础设施：会话、统一响应格式、地址与密钥。
// 从 index.ts 抽出来，避免路由模块反向 import 入口（那会成环）。
import { getCookie, setCookie } from "hono/cookie";
import { COOKIE, isSessionPayload, signJWT, verifyJWT } from "./auth";
import {
  first,
  getNode,
  listNodes,
  run,
  sessionEpochOf,
  type Env,
  type NodeRow,
} from "./db";

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
  // 并发首启时两个 isolate 会各生成一把，DO NOTHING 保证只有一把进库。
  // 输掉竞争的那个如果直接返回自己生成的值，它签出的会话在别的请求里永远验不过
  // （表现为「密码对了、页面一跳就被踢回登录」）。所以回读一次，以库中值为准。
  const won = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM meta WHERE key = 'jwt_secret'",
  );
  return won?.value ?? secret;
}

export async function currentUser(c: any): Promise<Session | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const payload = await verifyJWT(token, await secretOf(c.env));
  // isSessionPayload 会拒掉二次验证票据（otp:1）——那张票只是“密码正确”，不是登录成功。
  if (!isSessionPayload(payload)) return null;
  const uid = Number(payload.uid ?? 0);
  // 会话代次：改密 / 启停 2FA / 强制下线会让 users.session_epoch 前进，
  // 旧 cookie 里的 se 对不上就当场失效。没有这一位时，改密只是“换了下次登录的密码”，
  // 已经流出去的会话仍然能用到 24 小时窗口结束（并能签发新 token）。
  if (uid > 0) {
    const epoch = await sessionEpochOf(c.env.DB, uid);
    // payload.se 由 isSessionPayload 的类型谓词声明（auth.ts），签发处是
    // index.ts issueSession；老 cookie 没有这一位，按 0 处理。
    if (Number(payload.se ?? 0) !== epoch) return null;
  }
  return {
    username: payload.u,
    uid,
    mustChange: payload.mc === true,
  };
}

/**
 * 重新签发当前会话 cookie。
 *
 * 改密 / 启停 2FA 之后必须做这一步：users.session_epoch 已经 +1，旧 cookie 里的 se
 * 立刻对不上（这正是我们要的吊销效果），但**正在操作的这条会话**不该被自己踢掉，
 * 所以用新代次补签一次。
 */
export async function reissueSession(
  c: any,
  user: { uid: number; username: string; mustChange: boolean },
): Promise<string> {
  const se = await sessionEpochOf(c.env.DB, user.uid);
  const token = await signJWT(
    { u: user.username, uid: user.uid, mc: user.mustChange, se },
    await secretOf(c.env),
  );
  let https = true;
  try {
    https = new URL(c.req.url).protocol === "https:";
  } catch {
    https = true;
  }
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400,
    secure: https,
  });
  return token;
}

/**
 * 登录限流用的客户端地址。
 *
 * 取值策略由 TRUST_PROXY 决定，默认是 "cf"：
 *   cf（默认）—— 只有当请求同时带 CF-Connecting-IP 和 cf-ray 时才采信。
 *                cf-ray 是 Cloudflare 边缘必加、且会覆盖客户端伪造的同名头，
 *                所以「有 cf-ray」可以作为「确实从 CF 边缘进来」的证据。
 *   1 / true  —— 采信 X-Forwarded-For 的第一跳。仅当自建反代会**重写**该头时才能开。
 *   off       —— 完全不信任何头，统一落到 "direct" 桶。
 *
 * 为什么不能像以前那样无条件信 XFF：自托管直连时 XFF 是客户端随便填的，
 * 每次换一个值就能让每个桶的计数都到不了阈值 → 无限次猜密码。
 *
 * 注意：即使 header 不可信也不会导致无限猜测 —— 登录处还有一道**全局**失败上限
 * （不区分 IP），伪造 IP 只能改变分摊方式，不能突破总量。
 */
export function clientIp(c: any): string {
  const mode = String(c.env?.TRUST_PROXY ?? "cf").toLowerCase();
  if (mode === "off") return "direct";

  if (mode === "1" || mode === "true" || mode === "on") {
    const xff = c.req.header("X-Forwarded-For");
    if (xff) return xff.split(",")[0].trim();
    const real = c.req.header("X-Real-IP");
    if (real) return real;
    return "direct";
  }

  // 默认 cf：边缘证据（cf-ray）与真实客户端地址必须同时存在
  const cf = c.req.header("CF-Connecting-IP");
  if (cf && c.req.header("cf-ray")) return cf;
  return "direct";
}

/** 选中的节点：X-Remote-Server 头优先，缺省落到第一个启用节点。 */
/**
 * 让「第一个启用节点」的缓存立刻失效。
 *
 * 缓存 60 秒是为了省 D1 读取，但节点被禁用/删除/新增第一台时，
 * 这 60 秒里 resolveNode 还会返回旧的 NodeRow —— 表现为「禁用后照样能写它」
 * 或「新加的第一台节点 60 秒内不生效」。
 */
export function invalidateDefaultNode(): void {
  defaultNodeCache = null;
}

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
