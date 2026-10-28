// 全量备份 / 恢复。
// Cloudflare D1 没有"数据库文件"可下载，所以备份是一个 JSON 快照：
// 节点、每节点的对象集合、设置、用户（只有密码哈希）、Token、变更日志、用量、指令。
// 不含 jwt_secret（避免把会话密钥一起搬走），导入后旧会话自然失效、重新登录即可。
import type { D1Database } from '@cloudflare/workers-types'
import { all, batch, now } from './db'

const TABLES = ['nodes', 'objects', 'settings', 'changes', 'usage', 'commands', 'users', 'tokens'] as const
type Table = (typeof TABLES)[number]

export interface Bundle {
  kind: 'sui-cf-backup'
  version: number
  exported_at: number
  tables: Partial<Record<Table, Record<string, unknown>[]>>
}

export async function exportBundle(
  db: D1Database,
  exclude: string[] = [],
): Promise<Bundle> {
  const tables: Partial<Record<Table, Record<string, unknown>[]>> = {}
  for (const t of TABLES) {
    if (exclude.includes(t)) continue
    tables[t] = await all<Record<string, unknown>>(db, `SELECT * FROM ${t}`)
  }
  return { kind: 'sui-cf-backup', version: 1, exported_at: now(), tables }
}

/** 分批写入，避免单次 batch 语句过多。 */
async function insertRows(db: D1Database, table: Table, rows: Record<string, unknown>[]): Promise<void> {
  const CHUNK = 40
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const stmts = slice.map((row) => {
      const cols = Object.keys(row)
      const placeholders = cols.map(() => '?').join(', ')
      return db
        .prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
        .bind(...cols.map((c) => row[c] as never))
    })
    if (stmts.length) await batch(db, stmts)
  }
}

/**
 * 恢复：先清空再写入（整库覆盖）。
 * 顺序很重要——tokens 引用 users，objects/settings 引用 nodes，先插父表。
 */
export async function importBundle(db: D1Database, data: Bundle): Promise<{ imported: Record<string, number> }> {
  if (!data || data.kind !== 'sui-cf-backup') throw new Error('不是本面板导出的备份文件')
  if (Number(data.version) !== 1) throw new Error(`不支持的备份版本: ${data.version}`)

  const order: Table[] = ['nodes', 'users', 'tokens', 'objects', 'settings', 'changes', 'usage', 'commands']
  const imported: Record<string, number> = {}

  // 清空（逆序）
  await batch(
    db,
    [...order].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)),
  )

  for (const t of order) {
    const rows = data.tables?.[t] ?? []
    await insertRows(db, t, rows)
    imported[t] = rows.length
  }
  return { imported }
}
