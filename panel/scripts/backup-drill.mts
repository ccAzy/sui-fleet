// 备份 → 恢复 演练：把一份真实的库导出成 bundle，再导入一个空库，逐表对数。
//
// 为什么需要它：`restore.sh` 存在很久了，但"能恢复"一直只是推断——没人拿真实数据跑过。
// 这个脚本只读源库、只写工作库，生产库全程不碰。
//
// 用法：
//   npm run drill:backup -- /path/to/source.db [/tmp/work.db]
import { DatabaseSync } from "node:sqlite";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { exportBundle, importBundle } from "../src/backup";
import { SqliteD1 } from "../../apps/selfhost/src/d1";

const src = process.argv[2];
const work = process.argv[3] || "/tmp/sui-drill-work.db";
if (!src || !existsSync(src)) {
  console.error(`找不到源库：${src}\n用法：npm run drill:backup -- <source.db> [work.db]`);
  process.exit(2);
}

const TABLES = [
  "nodes",
  "objects",
  "settings",
  "changes",
  "usage",
  "commands",
  "users",
  "tokens",
  "meta",
] as const;


/** meta 只比对「包里带得走」的键：本地密钥（jwt_secret 等）按设计不进包。 */
async function metaCovered(srcDb: any, workDb: any): Promise<boolean> {
  const LOCAL = ["jwt_secret", "ops_token_hash", "backup_token_hash", "import_in_progress"];
  const rows = await srcDb.prepare("SELECT key, value FROM meta").all();
  const target = await workDb.prepare("SELECT key, value FROM meta").all();
  const map = new Map<string, string>(target.results.map((r: any) => [r.key, r.value]));
  const missing: string[] = [];
  for (const r of rows.results) {
    if (LOCAL.includes(r.key)) continue;
    if (!map.has(r.key)) missing.push(r.key);
  }
  if (missing.length) console.log(`    meta 缺失：${missing.join(", ")}`);
  return missing.length === 0;
}

const srcDb = SqliteD1.open(src);

// 1) 导出（生产库只读）
const bundle = await exportBundle(srcDb, []);
console.log(`导出：${TABLES.map((t) => `${t}=${bundle.tables?.[t]?.length ?? 0}`).join(" ")}`);

// 2) 空库 + schema
for (const f of [work, `${work}-wal`, `${work}-shm`]) rmSync(f, { force: true });
const raw = new DatabaseSync(work);
raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
raw.close();

// 3) 导入
const workDb = SqliteD1.open(work);
await importBundle(workDb, bundle);

// 4) 对数
let bad = 0;
const count = async (db: any, t: string) => {
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).first();
  return Number(row?.c ?? 0);
};

for (const t of TABLES) {
  // commands 与 tokens 一样属于"按设计不还原"：
  // commands 是下发给节点、由 agent 以 root 执行的队列；恢复备份等于复活一批
  // 可能早已作废的 root 指令。恢复后需要执行的命令重新下发。
  if (t === "commands" || t === "tokens") {
    // 导入策略明确不还原 API token（凭据复活风险），这里只标注不算失败
    const after = await count(workDb, t);
    console.log(`  ${t.padEnd(9)} 源=${String(await count(srcDb, t)).padStart(4)} 恢复=${String(after).padStart(4)}  （按设计不还原）`);
    continue;
  }
  const before = await count(srcDb, t);
  const after = await count(workDb, t);
  // changes +1 是导入自己写的审计行；meta 要按「包里带的键」比，而不是比行数
  // （本地密钥本来就不进包，恢复到全新库时自然不会出现）。
  const ok =
    t === "changes"
      ? after === before + 1
      : t === "meta"
        ? await metaCovered(srcDb, workDb)
        : before === after;
  if (!ok) bad++;
  console.log(`  ${t.padEnd(9)} 源=${String(before).padStart(4)} 恢复=${String(after).padStart(4)}  ${ok ? "ok" : "不一致"}`);
}

// 5) 抽查关键内容：节点数、客户端数、管理员能否登录的前提（users 非空）
const admin = await workDb.prepare("SELECT COUNT(*) AS c FROM users").first();
const nodes = await workDb.prepare("SELECT COUNT(*) AS c FROM nodes").first();
const clients = await workDb
  .prepare("SELECT COUNT(*) AS c FROM objects WHERE kind = 'clients'")
  .first();
console.log(`抽查：users=${admin?.c} nodes=${nodes?.c} clients=${clients?.c}`);

if (!Number(admin?.c)) {
  console.error("✗ 恢复库里没有管理员账号——恢复后无法登录");
  bad++;
}

console.log(bad === 0 ? "✓ 演练通过" : `✗ 演练失败：${bad} 处不一致`);
process.exit(bad === 0 ? 0 : 1);
