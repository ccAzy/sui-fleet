// D1 访问层：薄封装 + 行类型，避免 handler 里散落 SQL 与 any。
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "@cloudflare/workers-types";

/** 静态资源绑定：只声明我们要用到的 fetch，签名按 DOM 类型写。 */
export type AssetsBinding = {
  fetch: (input: Request) => Promise<Response>;
};

export type Env = {
  DB: D1Database;
  ASSETS: AssetsBinding;
  JWT_SECRET: string;
  PANEL_BASE: string;
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
};

export interface NodeRow {
  id: string;
  name: string;
  token_hash: string;
  address: string;
  sub_key: string;
  remark: string;
  enabled: number;
  revision: number;
  created_at: number;
  updated_at: number;
  last_seen: number;
  last_ip: string;
  agent_ver: string;
  kernel_ver: string;
  core_state: string;
  status_json: string;
  applied_rev: number;
  config_hash: string;
  hash_checked_at: number;
}

export interface ObjectRow {
  node_id: string;
  kind: string;
  obj_id: number;
  tag: string;
  data: string;
  updated_at: number;
}

export interface SettingRow {
  node_id: string;
  key: string;
  value: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  must_change: number;
  /** 会话代次：改密/启停 2FA 时 +1，旧 JWT 里的 se 对不上即失效 */
  session_epoch?: number;
  created_at: number;
  /** TOTP 密钥（base32）；空 = 未开启二次验证 */
  otp_secret?: string;
  /** 1 = 已开启 */
  otp_on?: number;
  /** 上次成功使用的 30 秒步长，用于防重放 */
  otp_last_step?: number;
  /** 恢复码的 sha256 数组（JSON），用掉一个删一个 */
  otp_recovery?: string;
}

/**
 * 给已存在的库补列（幂等）。
 *
 * `CREATE TABLE IF NOT EXISTS` 不会给老表加字段，所以升级必须显式 ALTER；
 * 而 ALTER 重复执行会报错，因此先读 PRAGMA 判断缺哪个。
 * 用 meta.schema_ver 做短路，避免每个请求都跑一次 PRAGMA。
 */
export async function ensureOtpSchema(db: D1Database): Promise<void> {
  const ver = await first<{ value: string }>(
    db,
    "SELECT value FROM meta WHERE key = 'schema_ver'",
  );
  if (ver?.value === "2") return;

  const cols = await all<{ name: string }>(db, "PRAGMA table_info(users)");
  const have = new Set(cols.map((c) => c.name));
  const add: Array<[string, string]> = [
    ["otp_secret", "TEXT NOT NULL DEFAULT ''"],
    ["otp_on", "INTEGER NOT NULL DEFAULT 0"],
    ["otp_last_step", "INTEGER NOT NULL DEFAULT 0"],
    ["otp_recovery", "TEXT NOT NULL DEFAULT '[]'"],
  ];
  for (const [name, decl] of add) {
    if (!have.has(name)) {
      await run(db, `ALTER TABLE users ADD COLUMN ${name} ${decl}`);
    }
  }
  await run(
    db,
    "INSERT INTO meta (key, value) VALUES ('schema_ver', '2') " +
      "ON CONFLICT(key) DO UPDATE SET value = '2'",
  );
}

export async function all<T>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return (res.results || []) as T[];
}

export async function first<T>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await db
    .prepare(sql)
    .bind(...params)
    .first<T>()) as T | null;
}

export async function run(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<D1Result> {
  return await db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** batch 在 D1 里是原子的，用于"对象 + 变更日志 + revision"一起落盘。 */
export async function batch(
  db: D1Database,
  stmts: D1PreparedStatement[],
): Promise<D1Result[]> {
  if (stmts.length === 0) return [];
  return await db.batch(stmts);
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 老库补 config_hash / hash_checked_at 两列。
 *
 * 沿用本项目既有的「用到才补」策略（ensureOtpSchema / ensureCommandRetrySchema），
 * 没有引入迁移框架 —— 这两列都是带默认值的可空语义列，补不上时退回「只比 revision」。
 */
let configHashReady = false;
export async function ensureConfigHashSchema(db: D1Database): Promise<void> {
  if (configHashReady) return;
  for (const col of [
    "config_hash TEXT NOT NULL DEFAULT ''",
    "hash_checked_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    try {
      await db.prepare(`ALTER TABLE nodes ADD COLUMN ${col}`).run();
    } catch {
      // 已存在就是正常情况
    }
  }
  configHashReady = true;
}

/**
 * 老库补 users.session_epoch。
 *
 * 为什么需要它：JWT 是无状态的，currentUser() 只验签名与 exp，账号侧改密/启停 2FA
 * 之后此前的 cookie 仍然有效（最多 24 小时），且还能签发新 token —— 改密对已泄露的
 * 会话等于无效止损。加一个代次位，签进 JWT 的 se，比对不上就当作未登录。
 */
let sessionEpochReady = false;
export async function ensureSessionEpoch(db: D1Database): Promise<void> {
  if (sessionEpochReady) return;
  try {
    await db
      .prepare(
        "ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  } catch {
    // 已存在就是正常情况
  }
  sessionEpochReady = true;
}

/**
 * 读某用户的会话代次（带 30 秒模块内缓存）。
 *
 * 为什么不每请求直查：面板前端高频轮询，每个已登录请求多一次 SELECT 会稳定推高
 * D1 rows_read。30 秒的吊销延迟对「改密止损」这个用途完全够用，且缓存按 uid 分桶，
 * 不会把新登录的会话误判成旧代次。
 */
const epochCache = new Map<number, { value: number; at: number }>();
const EPOCH_TTL = 30;

export async function sessionEpochOf(
  db: D1Database,
  uid: number,
  nowTs = Math.floor(Date.now() / 1000),
): Promise<number> {
  const hit = epochCache.get(uid);
  if (hit && nowTs - hit.at < EPOCH_TTL) return hit.value;
  let value: number;
  try {
    const row = await first<{ session_epoch: number }>(
      db,
      "SELECT session_epoch FROM users WHERE id = ?",
      uid,
    );
    value = Number(row?.session_epoch ?? 0);
  } catch {
    // 老库还没补列、或数据库瞬时不可用：返回 -1 表示「无法判定」，
    // 交给调用方放行并保持可用性（详见 http.ts currentUser 的处理与注释）。
    // 注意这不是常态：ensureSessionEpoch 会在下一次登录时把列补上。
    return -1;
  }
  epochCache.set(uid, { value, at: nowTs });
  return value;
}

/** 吊销某用户已签发的全部会话。 */
export async function bumpSessionEpoch(
  db: D1Database,
  uid: number,
): Promise<void> {
  await run(
    db,
    "UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?",
    uid,
  );
  epochCache.delete(uid);
}

/**
 * 补两个纯性能索引（老库靠这条迁移，新库由 schema.sql 直接建）。
 *
 * 为什么值得单独一个函数：登录限流的全局计数查询是**未认证请求**触发的，
 * 没有 ts 单列索引时每次尝试都全表扫 login_attempts，这张表又会按 7 天留存持续增长。
 */
let perfIndexesReady = false;
export async function ensurePerfIndexes(db: D1Database): Promise<void> {
  if (perfIndexesReady) return;
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_login_ts ON login_attempts(ts)",
    "CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at)",
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
      // 建不上不影响功能，最多是全表扫
    }
  }
  perfIndexesReady = true;
}

/** 节点配置版本 +1，让 agent 下次 pull 时拿到新快照。 */
export function bumpRevision(
  db: D1Database,
  nodeId: string,
): D1PreparedStatement {
  return db
    .prepare(
      // 同时清空 config_hash：内容一定变了，旧指纹必须失效，
      // 否则下一次 pull 会拿旧指纹和节点上的值比对，判成「没变化」。
      "UPDATE nodes SET revision = revision + 1, updated_at = ?, config_hash = '' WHERE id = ?",
    )
    .bind(now(), nodeId);
}

export function logChange(
  db: D1Database,
  nodeId: string,
  actor: string,
  kind: string,
  action: string,
  obj: unknown,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO changes (node_id, ts, actor, kind, action, obj) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(nodeId, now(), actor, kind, action, JSON.stringify(obj ?? {}));
}

export async function getNode(
  db: D1Database,
  id: string,
): Promise<NodeRow | null> {
  return await first<NodeRow>(db, "SELECT * FROM nodes WHERE id = ?", id);
}

export async function listNodes(db: D1Database): Promise<NodeRow[]> {
  return await all<NodeRow>(db, "SELECT * FROM nodes ORDER BY created_at ASC");
}

export async function getNodeByTokenHash(
  db: D1Database,
  hash: string,
): Promise<NodeRow | null> {
  return await first<NodeRow>(
    db,
    "SELECT * FROM nodes WHERE token_hash = ?",
    hash,
  );
}
