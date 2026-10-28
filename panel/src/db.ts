// D1 访问层：薄封装 + 行类型，避免 handler 里散落 SQL 与 any。
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types'

export type Env = {
  DB: D1Database
  JWT_SECRET: string
  PANEL_BASE: string
  ADMIN_USER?: string
  ADMIN_PASS?: string
}

export interface NodeRow {
  id: string
  name: string
  token_hash: string
  address: string
  sub_key: string
  remark: string
  enabled: number
  revision: number
  created_at: number
  updated_at: number
  last_seen: number
  last_ip: string
  agent_ver: string
  kernel_ver: string
  core_state: string
  status_json: string
  applied_rev: number
}

export interface ObjectRow {
  node_id: string
  kind: string
  obj_id: number
  tag: string
  data: string
  updated_at: number
}

export interface SettingRow {
  node_id: string
  key: string
  value: string
}

export interface UserRow {
  id: number
  username: string
  password_hash: string
  must_change: number
  created_at: number
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>()
  return (res.results || []) as T[]
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) as T | null
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return await db.prepare(sql).bind(...params).run()
}

/** batch 在 D1 里是原子的，用于"对象 + 变更日志 + revision"一起落盘。 */
export async function batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  if (stmts.length === 0) return []
  return await db.batch(stmts)
}

export function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** 节点配置版本 +1，让 agent 下次 pull 时拿到新快照。 */
export function bumpRevision(db: D1Database, nodeId: string): D1PreparedStatement {
  return db.prepare('UPDATE nodes SET revision = revision + 1, updated_at = ? WHERE id = ?').bind(now(), nodeId)
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
    .prepare('INSERT INTO changes (node_id, ts, actor, kind, action, obj) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(nodeId, now(), actor, kind, action, JSON.stringify(obj ?? {}))
}

export async function getNode(db: D1Database, id: string): Promise<NodeRow | null> {
  return await first<NodeRow>(db, 'SELECT * FROM nodes WHERE id = ?', id)
}

export async function listNodes(db: D1Database): Promise<NodeRow[]> {
  return await all<NodeRow>(db, 'SELECT * FROM nodes ORDER BY created_at ASC')
}

export async function getNodeByTokenHash(db: D1Database, hash: string): Promise<NodeRow | null> {
  return await first<NodeRow>(db, 'SELECT * FROM nodes WHERE token_hash = ?', hash)
}
