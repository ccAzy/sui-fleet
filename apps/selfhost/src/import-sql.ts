// 把 wrangler d1 export 出来的 SQL 灌进本地 SQLite。
// 用途：P1 影子实例、P3 迁移工具、以及"线上炸了从备份起一台"的应急流程。
//
//   npm run import -- .data/prod.sql .data/sui.db
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";

const [, , sqlPath = ".data/prod.sql", dbPath = ".data/sui.db"] = process.argv;

if (!existsSync(sqlPath)) {
  console.error(`找不到 SQL 文件：${sqlPath}`);
  process.exit(1);
}

// 重建而不是追加：导入的目标是"得到一份和线上一致的新库"
if (existsSync(dbPath)) {
  console.log(`删除已存在的库：${dbPath}`);
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

const sql = await readFile(sqlPath, "utf8");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");

const t0 = Date.now();
try {
  db.exec(sql);
} catch (err) {
  console.error("导入失败：", err instanceof Error ? err.message : err);
  db.close();
  process.exit(1);
}

// 逐表行数，便于和线上比对（P3 的校验就是基于这份输出）
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all() as Array<{ name: string }>;

let total = 0;
for (const { name } of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as {
    c: number;
  };
  total += Number(row.c);
  console.log(`  ${name.padEnd(18)} ${String(row.c).padStart(6)}`);
}

db.close();
console.log(
  `\n导入完成：${tables.length} 张表 / ${total} 行 / ${Date.now() - t0}ms → ${dbPath}`,
);
