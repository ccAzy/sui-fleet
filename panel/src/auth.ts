// 认证：PBKDF2-SHA256 存密码（Workers 无 bcrypt），HMAC-SHA256 自签 JWT 走 HttpOnly cookie。
import type { D1Database } from "@cloudflare/workers-types";
import { first, run, now, type UserRow } from "./db";

// Workers 免费版 CPU 上限 10ms，PBKDF2 迭代数直接决定登录会不会 500（实测 120k 就挂）。
// 自托管跑在 Node 上没有这个限制。哈希串里带了迭代数，所以两边能互相验证；
// 登录成功时按当前运行时的目标值顺手升格，不需要停机迁移。
const ITER_WORKER = 10_000;
const ITER_NODE = 600_000;

/** 当前运行时的密码哈希目标迭代数。 */
export function targetIterations(): number {
  // 交集断言：既保留 globalThis 原类型（Workers 类型下也能过），又能在 Node 下读 process
  const g = globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  };
  return typeof g.process?.versions?.node === "string"
    ? ITER_NODE
    : ITER_WORKER;
}

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const ITER = targetIterations();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${ITER}$${b64(salt.buffer)}$${b64(bits)}`;
}

/** PBKDF2 迭代上限。超过它一定是异常输入（正常的 ITER 是 1 万~60 万）。 */
export const PBKDF2_MAX_ITER = 2_000_000;

/**
 * 严格解析 `pbkdf2$<iter>$salt$hash` 里的迭代数。
 *
 * 必须**只此一份**：校验方与使用方用不同的解析规则时，上限形同虚设。
 * 实例：`pbkdf2$+200000$...` 不匹配 `(\d+)`（校验被跳过），
 * 而 parseInt("+200000") = 200000（照样生效）。统一走这里，
 * 正则与数值解析是同一套语义，谁都绕不过去。
 */
export function pbkdf2Iter(stored: string): number | null {
  const m = /^pbkdf2\$(\d{1,9})\$/.exec(stored);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iter = pbkdf2Iter(stored);
  if (iter === null) return false;
  const salt = unb64(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    key,
    256,
  );
  const got = b64(bits);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++)
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const enc = (o: unknown): string =>
  btoa(JSON.stringify(o))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 86400,
): Promise<string> {
  const body = { ...payload, iat: now(), exp: now() + ttlSeconds };
  const head = enc({ alg: "HS256", typ: "JWT" });
  const data = `${head}.${enc(body)}`;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(data),
  );
  return `${data}.${b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/**
 * 恒定时间字符串比较。
 *
 * 用在两处：JWT 签名比对、/__cron 的密钥比对。用 `!==` 时提前返回的时机取决于第几个
 * 字符不匹配，理论上可被逐字节猜（网络抖动下噪声很大，但不该留这个形状）。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyJWT(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(data),
  );
  const expect = b64(sig)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (!timingSafeEqual(expect, parts[2])) return null;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
    // exp 必须是数字且存在。原实现把"没有 exp"当成"永不过期"——
    // 签发方只要漏写一个字段，那张令牌就是永久会话，且没有任何地方会报警。
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getUser(
  db: D1Database,
  username: string,
): Promise<UserRow | null> {
  return await first<UserRow>(
    db,
    "SELECT * FROM users WHERE username = ?",
    username,
  );
}

/** 首次启动按 env 里的 ADMIN_USER / ADMIN_PASS 建号（缺省 admin/admin）。 */
export async function ensureAdmin(
  db: D1Database,
  user = "admin",
  pass = "admin",
): Promise<boolean> {
  const exists = await first<UserRow>(db, "SELECT id FROM users LIMIT 1");
  if (exists) return false;
  // 没配 ADMIN_PASS（或还是 admin）时强制首次登录改密，避免面板裸奔
  const weak = !pass || pass === "admin";
  await run(
    db,
    "INSERT INTO users (username, password_hash, must_change, created_at) VALUES (?, ?, ?, ?)",
    user,
    await hashPassword(pass || "admin"),
    weak ? 1 : 0,
    now(),
  );
  return true;
}

export async function login(
  db: D1Database,
  username: string,
  password: string,
): Promise<UserRow | null> {
  const u = await getUser(db, username);
  if (!u) return null;
  if (!(await verifyPassword(password, u.password_hash))) return null;

  // 渐进升格：老库里的 10k 哈希在自托管（目标 600k）登录成功后自动重算一次。
  // 不改密码、不需要迁移脚本，用户无感。
  const stored = parseInt(u.password_hash.split("$")[1] ?? "0", 10);
  if (stored > 0 && stored < targetIterations()) {
    const fresh = await hashPassword(password);
    await run(
      db,
      "UPDATE users SET password_hash = ? WHERE id = ?",
      fresh,
      u.id,
    );
    u.password_hash = fresh;
  }
  return u;
}

/**
 * API Token 是否仍然有效（纯函数，便于单测）。
 *
 * expiry = 0 表示永不过期；否则必须晚于当前时间。
 * 这张表原来只在 UI 里增删查、从不参与鉴权（死凭据），
 * 现在作为「只读接口的脚本访问凭据」使用。
 */
export function tokenIsValid(
  row: { expiry?: number } | null | undefined,
  nowTs: number,
): boolean {
  if (!row) return false;
  const exp = Number(row.expiry ?? 0) || 0;
  return exp === 0 || exp > nowTs;
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** agent token：随机 32 字节，库里只存 sha256。 */
export async function newAgentToken(): Promise<{
  token: string;
  hash: string;
}> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash: await sha256(token) };
}

export const COOKIE = "sui_session";

/**
 * 备份令牌：给"顺位 2 的定时快照"用——无人值守地拉一次全量备份。
 *
 * 为什么需要：`/api/getdb` 原本只认登录会话，备用机没有密码（也不该有），
 * 于是备份只能靠人工点。令牌存在 meta.backup_token_hash（只存 sha256），
 * 48 位 hex、常数时间比较、每次使用落一条 changes 审计。
 *
 * 这个令牌能读到整库（含密码哈希与 TOTP 密钥），因此只在"备用机定时拉"这一
 * 个场景使用，且必须与面板同域不同路径地暴露在 HTTPS 后面。
 */
/** 常量时间比较：把库里的 sha256 与候选令牌的 sha256 逐字节异或累加。 */
async function hashEquals(
  db: D1Database,
  metaKey: string,
  token: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{48}$/.test(token)) return false;
  const row = await first<{ value: string }>(
    db,
    "SELECT value FROM meta WHERE key = ?",
    metaKey,
  );
  if (!row?.value) return false;
  const got = await sha256(token);
  if (got.length !== row.value.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++)
    diff |= got.charCodeAt(i) ^ row.value.charCodeAt(i);
  return diff === 0;
}

/**
 * 会话载荷校验（纯函数，便于单测）。
 * 关键约束：二次验证票据（otp:1）是「密码正确」的临时凭证，不能当会话。
 */
export function isSessionPayload(
  payload: Record<string, unknown> | null,
): payload is { u: string; uid?: number; mc?: boolean; se?: number } {
  if (!payload || typeof payload.u !== "string") return false;
  if (payload.otp === 1) return false;
  // uid 必须存在：currentUser 只在 uid > 0 时比对会话代次，
  // 允许无 uid 的载荷等于放行一批「永远无法吊销」的会话。
  return typeof payload.uid === "number" && payload.uid > 0;
}

export async function verifyBackupToken(
  db: D1Database,
  token: string,
): Promise<boolean> {
  // 只认 backup_token_hash：两个令牌各管各的，混用等于把「拉备份」的权限
  // 升级成「改仲裁代次」的权限。
  return hashEquals(db, "backup_token_hash", token);
}

/**
 * 运维令牌：只用于仲裁者读写等运维动作。
 * 不再回退到 backup_token_hash —— 两个令牌必须能独立轮换、独立收紧。
 */
export async function verifyOpsToken(
  db: D1Database,
  token: string,
): Promise<boolean> {
  return hashEquals(db, "ops_token_hash", token);
}

/**
 * 拉备份专用的令牌校验：backup 或 ops 均可（已部署机只需一个令牌就能拉快照）。
 * 仅 /api/getdb 使用；不得用于任何写接口。
 */
export async function verifyPullToken(
  db: D1Database,
  token: string,
): Promise<boolean> {
  if (await verifyBackupToken(db, token)) return true;
  return await verifyOpsToken(db, token);
}
