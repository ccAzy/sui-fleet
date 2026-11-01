// 全量备份 / 恢复。
// Cloudflare D1 没有"数据库文件"可下载，所以备份是一个 JSON 快照：
// 节点、每节点的对象集合、设置、用户（只有密码哈希）、Token、变更日志、用量、指令。
// 不含 jwt_secret（避免把会话密钥一起搬走），导入后旧会话自然失效、重新登录即可。
import type { D1Database } from "@cloudflare/workers-types";
import { PBKDF2_MAX_ITER, pbkdf2Iter } from "./auth";
import { all, batch, now } from "./db";

const TABLES = [
  "nodes",
  "objects",
  "settings",
  "changes",
  "usage",
  "commands",
  "users",
  "tokens",
] as const;

// meta 单独处理：它是"运维配置 + 密钥"混在一起的表。
// 必须带走的（否则恢复后聚合订阅/仲裁代次会丢）：agg_key、control_*、内核与发布缓存。
// 必须留下的（跟这台实例绑定的秘密）：jwt_secret、ops_token_hash、backup_token_hash。
const META_CARRY = [
  "agg_key",
  "control_epoch",
  "control_primary",
  "control_order",
  "control_switched_at",
  "kernel_latest",
  "kernel_checked_at",
  "agent_release_url",
  "agent_release_sha256",
  "agent_release_version",
  "cleanup_at",
  "schema_ver",
];
type Table = (typeof TABLES)[number] | "meta";

export interface Bundle {
  kind: "sui-cf-backup";
  version: number;
  exported_at: number;
  tables: Partial<Record<Table, Record<string, unknown>[]>>;
}

export async function exportBundle(
  db: D1Database,
  exclude: string[] = [],
): Promise<Bundle> {
  const tables: Partial<Record<Table, Record<string, unknown>[]>> = {};
  for (const t of TABLES) {
    if (exclude.includes(t)) continue;
    tables[t] = await all<Record<string, unknown>>(db, `SELECT * FROM ${t}`);
  }
  const placeholders = META_CARRY.map(() => "?").join(", ");
  tables.meta = await all<Record<string, unknown>>(
    db,
    `SELECT key, value FROM meta WHERE key IN (${placeholders})`,
    ...META_CARRY,
  );
  return { kind: "sui-cf-backup", version: 1, exported_at: now(), tables };
}

// 跟这台实例绑定的秘密：恢复时必须原样保留，否则备份令牌失效（待机快照停摆）、
// 运维令牌失效（仲裁者再也写不进 epoch）、所有会话全掉。
const LOCAL_SECRET_KEYS = ["jwt_secret", "ops_token_hash", "backup_token_hash"];

/** 单次 batch 的语句上限：D1 的 batch 是事务性的，但语句太多会超限，所以分档。 */
const ATOMIC_BATCH_MAX = 400;

/**
 * 恢复：整库覆盖。
 *
 * 三条必须守住的约束（历史上都出过事）：
 *   1. jwt_secret / ops_token_hash / backup_token_hash 不能被备份覆盖或删掉；
 *   2. 能一次 batch 跑完就一次跑完 —— D1 的 batch 是事务，失败整体回滚；
 *   3. 语句太多必须分块时，先落 import_in_progress 标记，恢复完再清，
 *      半途失败时能一眼看出“这个库是半个”。
 */
export async function importBundle(
  db: D1Database,
  data: Bundle,
): Promise<{ imported: Record<string, number> }> {
  if (!data || data.kind !== "sui-cf-backup")
    throw new Error("不是本面板导出的备份文件");
  if (Number(data.version) !== 1)
    throw new Error(`不支持的备份版本: ${data.version}`);

  // 一个「格式合法但没有任何数据」的备份会把整库 DELETE 干净：
  // 先删后插的 batch 里没有插入语句，最后提交成功、返回 imported:{}。
  // 这里要求至少带 nodes 或 users，否则直接拒绝。
  const t = (data.tables ?? {}) as Record<string, unknown>;
  const nNodes = Array.isArray(t.nodes) ? t.nodes.length : 0;
  const nUsers = Array.isArray(t.users) ? t.users.length : 0;
  if (nNodes === 0 && nUsers === 0)
    throw new Error("备份里既没有 nodes 也没有 users，拒绝导入（会清空整库）");

  const order: Table[] = [
    "nodes",
    "users",
    "tokens",
    "objects",
    "settings",
    "changes",
    "usage",
    "commands",
    "meta",
  ];

  // 0) 校验外部数据里「会伤到自己」的两个值
  //
  //  (a) control_epoch 必须单调：/api/arbiter 用 Math.max 防止被降低，但导入不看这个，
  //      恢复一份旧快照就能把 epoch 倒退，防脑裂的闸门等于被绕过。
  //  (b) PBKDF2 的 iter 来自哈希串本身：一个 pbkdf2$2000000000$... 的备份会让管理员
  //      下次登录时 CPU 爆炸（Worker 直接超时）。这里限制上界。
  const incomingMeta = Array.isArray((data.tables as any)?.meta)
    ? ((data.tables as any).meta as Array<Record<string, unknown>>)
    : [];
  // 归一化：meta 是 key/value 表，重复键会变成「校验读第一行、写入取最后一行」的
  // 语义分裂（find 是 first-wins，INSERT OR REPLACE 是 last-wins）。直接拒绝。
  const metaMap = new Map<string, string>();
  for (const r of incomingMeta) {
    const k = String(r.key ?? "");
    if (!k) continue;
    if (metaMap.has(k))
      throw new Error(`备份里的 meta 有重复键：${k}（拒绝导入，不做静默取舍）`);
    metaMap.set(k, String(r.value ?? ""));
  }
  // 这三个键决定「节点将以 root 执行什么」和「聚合订阅凭据」。在线接口
  // （/api/release）有校验，导入路径原来一条都没有 —— 于是导入成了
  // 绕过校验的第二条写入通道。这里补齐同样的约束。
  const releaseUrl = metaMap.get("agent_release_url") ?? "";
  const releaseSha = (metaMap.get("agent_release_sha256") ?? "").toLowerCase();
  if (releaseUrl) {
    if (!/^https:\/\//.test(releaseUrl))
      throw new Error("备份里的更新地址必须是 https");
    if (!/^[0-9a-f]{64}$/.test(releaseSha))
      throw new Error("备份里设置了更新地址却没有 64 位 hex 的 sha256");
  }
  const aggKey = metaMap.get("agg_key");
  if (aggKey !== undefined && !/^[0-9a-f]{16,64}$/.test(aggKey))
    throw new Error("备份里的 agg_key 格式非法");

  const incomingEpoch = Number(metaMap.get("control_epoch") ?? 0);
  if (incomingEpoch > 0) {
    const localEpochRow = await all<{ value: string }>(
      db,
      "SELECT value FROM meta WHERE key = 'control_epoch'",
    );
    const localEpoch = Number(localEpochRow[0]?.value ?? 0) || 0;
    if (incomingEpoch < localEpoch) {
      // 不能悄悄覆盖：这正是 5.5-C 描述的脑裂入口。
      // 归一化之后只有一个值，直接覆盖它（原来是遍历数组逐条改，语义等价但会漏改）。
      metaMap.set("control_epoch", String(localEpoch));
    }
  }
  const incomingUsers = Array.isArray((data.tables as any)?.users)
    ? ((data.tables as any).users as Array<Record<string, unknown>>)
    : [];
  for (const u of incomingUsers) {
    const h = String(u.password_hash ?? "");
    // 必须与 auth.ts verifyPassword 用同一套解析：曾经这里用 /\d+/ 校验、那边用
    // parseInt 使用，"pbkdf2$+200000$…" 正则不匹配（跳过校验）、parseInt 却生效。
    const iter = pbkdf2Iter(h);
    if (iter !== null && iter > PBKDF2_MAX_ITER)
      throw new Error(
        `备份里的 PBKDF2 迭代数异常（${iter}），拒绝导入以免登录时耗尽 CPU`,
      );
  }

  // 1) 先读本地秘密（备份里就算带了也不认）
  const localSecrets = await all<{ key: string; value: string }>(
    db,
    "SELECT key, value FROM meta WHERE key IN ('jwt_secret','ops_token_hash','backup_token_hash')",
  );

  // 2) 预检 + 拼语句
  const imported: Record<string, number> = {};
  const stmts: ReturnType<typeof db.prepare>[] = [];

  // 列名会直接拼进 SQL（列名无法参数化），所以必须对照真实表结构过滤。
  // 备份是**外部输入**：换台机器导入别人的包时，行里可以带任意 key，
  // 例如 {"a) VALUES(1); DROP TABLE users; --": 1} 就是一个注入点。
  const validCols = new Map<string, Set<string>>();
  for (const t of order) {
    const info = await all<{ name: string }>(db, `PRAGMA table_info(${t})`);
    validCols.set(t, new Set(info.map((r) => String(r.name))));
  }
  const rmStmts = [...order]
    .reverse()
    .map((t) => db.prepare(`DELETE FROM ${t}`));
  stmts.push(...rmStmts);
  // 秘密回填紧贴删除 —— 这两组语句在执行段被放进同一个原子批。
  // 原来把它们放在最后：分块导入中途失败就会停在「jwt_secret 已删、还没补回」，
  // 所有人被登出、ops token 校验失去依据，而 import_in_progress 也一起没了。
  const secretStmts = localSecrets.map((s) =>
    db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .bind(s.key, s.value),
  );
  stmts.push(...secretStmts);
  for (const t of order) {
    const rows = data.tables?.[t] ?? [];
    if (!Array.isArray(rows)) throw new Error(`备份里的 ${t} 不是数组`);
    const filtered =
      t === "meta"
        ? rows.filter((r) => !LOCAL_SECRET_KEYS.includes(String(r.key ?? "")))
        : rows;
    for (const row of filtered) {
      const allowed = validCols.get(t) ?? new Set<string>();
      // 只保留本表真实存在的列；多余的键直接丢弃（不静默建列、不拼进 SQL）
      const cols = Object.keys(row).filter((c) => allowed.has(c));
      if (!cols.length) continue;
      const ph = cols.map(() => "?").join(", ");
      stmts.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO ${t} (${cols.join(", ")}) VALUES (${ph})`,
          )
          .bind(...cols.map((c) => row[c] as never)),
      );
    }
    imported[t] = filtered.length;
  }
  // 导入会把 nodes 整表替换掉：revision 很可能与节点上已应用的值相同，
  // 但内容来自另一份库。清空 config_hash 强制下一次 pull 重算指纹，
  // 这样「恢复/克隆之后节点永远跑旧配置」就不会发生。
  stmts.push(
    db.prepare("UPDATE nodes SET config_hash = '', hash_checked_at = 0"),
  );

  // 本地秘密必须紧跟在删除语句之后回填（见下方执行段：这两类语句同属一个原子批）。

  // 3) 执行：小库单事务；大库先原子地跑完「删表 + 秘密回填」，再分块灌数据。
  if (stmts.length <= ATOMIC_BATCH_MAX) {
    await batch(db, stmts);
    return { imported };
  }
  const headCount = rmStmts.length + secretStmts.length;
  await batch(db, stmts.slice(0, headCount));
  const rest = stmts.slice(headCount);

  await db
    .prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('import_in_progress', ?)",
    )
    .bind(String(now()))
    .run();
  try {
    for (let i = 0; i < rest.length; i += 40)
      await batch(db, rest.slice(i, i + 40));
  } catch (e) {
    throw new Error(
      `导入在 ${rest.length} 条语句中途失败（表已清空、本地密钥完好；meta.import_in_progress 已置位，重跑一次导入即可）：${String(e)}`,
    );
  }
  await db.prepare("DELETE FROM meta WHERE key = 'import_in_progress'").run();
  return { imported };
}
