// 两个 SQLite 库的一致性校验：表集合、逐表行数、逐表内容哈希。
// 用途：迁移后确认"导出的库 == 线上的库"，以及备份恢复后的对账。
//
//   npm run verify -- .data/sui.db .data/check.db
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

const [, , a = '.data/sui.db', b = '.data/check.db'] = process.argv

for (const p of [a, b]) {
  if (!existsSync(p)) {
    process.stderr.write(`找不到数据库：${p}\n`)
    process.exit(1)
  }
}

const open = (p: string) => new DatabaseSync(p, { readOnly: true })
const dbA = open(a)
const dbB = open(b)

const tablesOf = (db: DatabaseSync): string[] =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name)

// 只比“配置性”列：last_seen / status_json / core_state 这些每 60 秒就变，比了整个校验就永远是红的。
// 而 token_hash / sub_key / revision / name 这些必须搬过去完全一致，所以单独投影。
const NODE_STABLE = 'id, name, token_hash, address, sub_key, remark, enabled, revision, created_at'

const tableHash = (db: DatabaseSync, table: string): { rows: number; hash: string } => {
  const sql =
    table === 'nodes'
      ? `SELECT ${NODE_STABLE} FROM nodes ORDER BY id`
      : `SELECT * FROM "${table}" ORDER BY rowid`
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>
  const h = createHash('sha256')
  for (const row of rows) h.update(JSON.stringify(row))
  return { rows: rows.length, hash: h.digest('hex').slice(0, 16) }
}

const skip = new Set(['usage', 'changes']) // 这两张表会被运行时持续写入，迁移对比时允许不同
const ta = tablesOf(dbA)
const tb = tablesOf(dbB)

let bad = 0
const out: string[] = []

if (ta.join(',') !== tb.join(',')) {
  out.push(`表集合不一致:\n  A: ${ta.join(' ')}\n  B: ${tb.join(' ')}`)
  bad++
}

for (const t of ta.filter((x) => tb.includes(x))) {
  const ra = tableHash(dbA, t)
  const rb = tableHash(dbB, t)
  const same = ra.rows === rb.rows && ra.hash === rb.hash
  if (!same && !skip.has(t)) bad++
  out.push(
    `  ${same ? 'OK  ' : skip.has(t) ? 'DIFF' : 'BAD '} ${t.padEnd(16)} ` +
      `rows ${String(ra.rows).padStart(5)}/${String(rb.rows).padStart(5)}  hash ${ra.hash}/${rb.hash}`,
  )
}

dbA.close()
dbB.close()

process.stdout.write(out.join('\n') + '\n')
process.stdout.write(
  bad === 0
    ? `\n结论：一致（${ta.length} 张表；usage/changes 为运行时表已忽略，nodes 只比配置列）\n`
    : `\n结论：发现 ${bad} 处不一致\n`,
)
process.exit(bad === 0 ? 0 : 2)
