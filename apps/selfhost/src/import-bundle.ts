// 把面板的 JSON 备份（/api/getdb 导出）灌进一个新的 SQLite 库。
// 与 import-sql.ts 的区别：那个吃的是 wrangler 的 SQL dump（含 DDL），
// 这个吃的是运行中的面板导出的数据快照，表结构从 panel/schema.sql 建。
//
//   npm run import-bundle -- bundle.json .data/standby.db
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import { importBundle, type Bundle } from "../../../panel/src/backup.ts";
import { ensureOtpSchema } from "../../../panel/src/db.ts";
import { SqliteD1 } from "./d1.ts";

const [, , jsonPath, dbPath = ".data/standby.db"] = process.argv;

if (!jsonPath || !existsSync(jsonPath)) {
  process.stderr.write(
    `用法：npm run import-bundle -- <bundle.json> [db 路径]\n`,
  );
  process.exit(1);
}

const schemaPath = resolve(import.meta.dirname, "../../../panel/schema.sql");
const schema = await readFile(schemaPath, "utf8");
const raw = await readFile(jsonPath, "utf8");
let bundle: Bundle;
try {
  bundle = JSON.parse(raw) as Bundle;
} catch (err) {
  process.stderr.write(
    `备份文件不是合法 JSON：${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}

if (bundle.kind !== "sui-cf-backup") {
  process.stderr.write(`不是面板导出的备份（kind=${String(bundle.kind)}）\n`);
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  const f = dbPath + suffix;
  if (existsSync(f)) unlinkSync(f);
}

const sqlite = new DatabaseSync(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec(schema);

const d1 = new SqliteD1(sqlite);
// 老版本的 schema.sql 可能还没有 otp_* 列：这里补一次，避免导入 users 时报表不存在
await ensureOtpSchema(d1 as never);
const t0 = Date.now();
const { imported } = await importBundle(d1 as never, bundle);

sqlite.close();

const lines = Object.entries(imported).map(
  ([t, n]) => `  ${t.padEnd(16)} ${String(n).padStart(6)}`,
);
process.stdout.write(
  `导入完成（导出时间 ${new Date(bundle.exported_at * 1000).toISOString()}，${Date.now() - t0}ms）\n` +
    lines.join("\n") +
    `\n→ ${dbPath}\n`,
);
