// 全量备份 / 恢复。
// Cloudflare D1 没有"数据库文件"可下载，所以备份是一个 JSON 快照：
// 节点、每节点的对象集合、设置、用户（只有密码哈希）、Token、变更日志、用量、指令。
// 不含 jwt_secret（避免把会话密钥一起搬走），导入后旧会话自然失效、重新登录即可。
import type { D1Database } from "@cloudflare/workers-types";
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
  for (const t of [...order].reverse())
    stmts.push(db.prepare(`DELETE FROM ${t}`));
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
  for (const s of localSecrets)
    stmts.push(
      db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .bind(s.key, s.value),
    );

  // 3) 执行：小库单事务，大库分块 + 半成品标记
  if (stmts.length <= ATOMIC_BATCH_MAX) {
    await batch(db, stmts);
    return { imported };
  }

  await db
    .prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('import_in_progress', ?)",
    )
    .bind(String(now()))
    .run();
  try {
    for (let i = 0; i < stmts.length; i += 40)
      await batch(db, stmts.slice(i, i + 40));
  } catch (e) {
    throw new Error(
      `导入在 ${stmts.length} 条语句中途失败（库可能是半成品，meta.import_in_progress 已置位）：${String(e)}`,
    );
  }
  await db.prepare("DELETE FROM meta WHERE key = 'import_in_progress'").run();
  return { imported };
}
