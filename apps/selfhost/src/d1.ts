// D1 兼容层：把 Cloudflare 的 D1Database 语义映射到 node:sqlite。
//
// 为什么用 node:sqlite 而不是 better-sqlite3：Node 22.5+ 内置，无需原生编译，
// 在最小化 VPS（无 gcc/python）上也能直接跑。
//
// 业务代码（panel/src）只用到这些面：
//   db.prepare(sql).bind(...).first() / .all() / .run()
//   db.batch([stmts])            // 隐式事务
//   res.meta.last_row_id         // 1 处
// 因此 shim 只需要把 5 个差异抹平（见 docs/plan-panel-portability.html · P0）。
import { DatabaseSync } from 'node:sqlite'

type Row = Record<string, unknown>

export interface D1Meta {
  changes: number
  last_row_id: number
  rows_read: number
  rows_written: number
  duration: number
}

const emptyMeta = (read = 0, written = 0): D1Meta => ({
  changes: written,
  last_row_id: 0,
  rows_read: read,
  rows_written: written,
  duration: 0,
})

/** node:sqlite 接受的绑定值（D1 同上，只差布尔/undefined 要归一）。 */
export type SqlValue = string | number | null | Uint8Array

/** D1 只接受 string / number / null / ArrayBuffer；布尔和 undefined 会被拒。 */
function normArg(v: unknown): SqlValue {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined || v === null) return null
  if (typeof v === 'string' || typeof v === 'number') return v
  if (v instanceof Uint8Array) return v
  if (v instanceof Date) return v.toISOString()
  return JSON.stringify(v)
}

export class SqliteStatement {
  private args: unknown[] = []

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): SqliteStatement {
    this.args = args.map(normArg)
    return this
  }

  private prepared() {
    return this.db.prepare(this.sql)
  }

  // D1 的 .first() 在 better-sqlite3 里叫 .get()，这里统一暴露成 first()
  async first<T = Row>(): Promise<T | null> {
    const row = this.prepared().get(...(this.args as never[])) as T | undefined
    return row ?? null
  }

  // D1 返回 { results, meta }，而调用方（panel/src/db.ts）取的是 .results
  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: D1Meta }> {
    const rows = this.prepared().all(...(this.args as never[])) as T[]
    return { results: rows, success: true, meta: emptyMeta(rows.length) }
  }

  async run(): Promise<{ success: true; meta: D1Meta }> {
    const info = this.prepared().run(...(this.args as never[]))
    return {
      success: true,
      meta: {
        ...emptyMeta(0, Number(info.changes ?? 0)),
        last_row_id: Number(info.lastInsertRowid ?? 0),
      },
    }
  }
}

export class SqliteD1 {
  constructor(readonly raw: DatabaseSync) {
    // WAL 更适合"一个写者 + 若干读者"的控制面；busy_timeout 避免瞬时锁冲突直接报错
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    this.raw.exec('PRAGMA foreign_keys = ON')
  }

  static open(path: string): SqliteD1 {
    return new SqliteD1(new DatabaseSync(path))
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.raw, sql)
  }

  /** D1 的 batch 是隐式事务：要么全成功，要么全回滚。 */
  async batch(stmts: SqliteStatement[]): Promise<Array<{ success: true; meta: D1Meta }>> {
    if (stmts.length === 0) return []
    const out: Array<{ success: true; meta: D1Meta }> = []
    this.raw.exec('BEGIN')
    try {
      for (const s of stmts) out.push(await s.run())
      this.raw.exec('COMMIT')
      return out
    } catch (err) {
      this.raw.exec('ROLLBACK')
      throw err
    }
  }

  async exec(sql: string): Promise<void> {
    this.raw.exec(sql)
  }

  close(): void {
    this.raw.close()
  }
}
