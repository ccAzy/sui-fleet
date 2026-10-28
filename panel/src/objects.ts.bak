// s-ui 兼容的对象层：/api/save 的 object/action/data 语义 + /api/load 的返回形状。
// 设计：对象按 raw JSON 存（保留前端交互形态），关联只做必要的引用维护；
// sing-box 配置渲染留在节点侧（复用 s-ui 原生 Go 逻辑），这里不重复实现。
import type { D1Database } from '@cloudflare/workers-types'
import { all, batch, bumpRevision, first, logChange, now, type ObjectRow } from './db'
import { genLinks } from './links'

type J = Record<string, unknown>
const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v)
const o = (v: unknown): J => (isObj(v) ? v : {})
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : parseInt(String(v ?? 0), 10) || 0)

export const OBJECT_KINDS = ['inbounds', 'outbounds', 'endpoints', 'services', 'tls', 'clients'] as const
export type ObjectKind = (typeof OBJECT_KINDS)[number]

export const DEFAULT_CONFIG: J = {
  log: { level: 'info', timestamp: true },
  dns: {
    servers: [{ tag: 'google', address: 'tls://8.8.8.8', detour: 'direct' }],
    rules: [{ domain: ['geosite:cn'], server: 'local' }],
    final: 'google',
    strategy: 'prefer_ipv4',
  },
  inbounds: [],
  outbounds: [],
  route: {
    rules: [{ protocol: 'dns', outbound: 'dns-out' }],
    rule_set: [],
    final: 'direct',
    auto_detect_interface: true,
    default_domain_resolver: 'google',
  },
  experimental: {
    cache_file: { enabled: true, path: 'cache.db' },
    clash_api: { external_controller: '127.0.0.1:9090' },
  },
}

const USER_TYPES = new Set([
  'vless','vmess','trojan','shadowsocks','shadowtls','hysteria','hysteria2','tuic','anytls','socks','http','mixed',
])

/** s-ui 在读取时会把"引用了该入站的客户端"挂进 inbound.users，面板据此显示客户端数。
 *  存储里不落这个字段（它由客户端表推导），所以每次读的时候现算。 */
function protocolKeyOf(inbound: J): string {
  const type = s(inbound.type)
  if (type === 'shadowsocks') {
    const m = s(inbound.method)
    return m.startsWith('2022') ? m : 'shadowsocks'
  }
  return type
}

function inboundIds(c: J): number[] {
  return (Array.isArray(c.inbounds) ? c.inbounds : [])
    .map((x) => (typeof x === 'number' ? x : num(o(x).id)))
    .filter((n) => n > 0)
}

function hydrateUsers(inbounds: J[], clients: J[]): J[] {
  const enabled = clients.filter((c) => c.enable !== false)
  return inbounds.map((ib) => {
    const type = s(ib.type)
    if (!USER_TYPES.has(type)) return ib
    const id = num(ib.id)
    const key = protocolKeyOf(ib)
    const users = enabled
      .filter((c) => inboundIds(c).includes(id))
      .map((c) => o(o(c.config)[key]))
      .filter((u) => Object.keys(u).length > 0)
    return { ...ib, users }
  })
}

export async function listObjects(db: D1Database, nodeId: string, kind: ObjectKind): Promise<J[]> {
  const rows = await all<ObjectRow>(
    db,
    'SELECT * FROM objects WHERE node_id = ? AND kind = ? ORDER BY obj_id ASC',
    nodeId,
    kind,
  )
  return rows.map((r) => {
    try {
      return JSON.parse(r.data) as J
    } catch {
      return {} as J
    }
  })
}

export async function getConfig(db: D1Database, nodeId: string): Promise<J> {
  const row = await first<{ value: string }>(db, "SELECT value FROM settings WHERE node_id = ? AND key = 'config'", nodeId)
  if (!row?.value) return { ...DEFAULT_CONFIG }
  try {
    return JSON.parse(row.value) as J
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function getSettings(db: D1Database, nodeId: string): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings WHERE node_id = ?', nodeId)
  const out: Record<string, string> = {}
  for (const r of rows) if (r.key !== 'config') out[r.key] = r.value
  return out
}

/** /api/load 的完整响应（前端 setNewData 消费）。 */
export async function loadFull(db: D1Database, nodeId: string, subURI: string): Promise<J> {
  const [config, clients, tls, inboundsRaw, outbounds, endpoints, services] = await Promise.all([
    getConfig(db, nodeId),
    listObjects(db, nodeId, 'clients'),
    listObjects(db, nodeId, 'tls'),
    listObjects(db, nodeId, 'inbounds'),
    listObjects(db, nodeId, 'outbounds'),
    listObjects(db, nodeId, 'endpoints'),
    listObjects(db, nodeId, 'services'),
  ])
  return {
    config,
    clients,
    tls,
    inbounds: hydrateUsers(inboundsRaw, clients),
    outbounds,
    endpoints,
    services,
    subURI,
    enableTraffic: true,
    onlines: { inbound: [], outbound: [], user: [] },
  }
}

/** 变更检测：lu 之后的 changes 记录存在则需刷新。 */
export async function changedSince(db: D1Database, nodeId: string, lu: string): Promise<boolean> {
  if (!lu) return true
  const t = parseInt(lu, 10)
  if (!t) return true
  const row = await first<{ c: number }>(
    db,
    'SELECT COUNT(*) as c FROM changes WHERE node_id = ? AND ts > ?',
    nodeId,
    t,
  )
  return (row?.c ?? 0) > 0
}

function toArray(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [data]
}

function idsOf(data: unknown): number[] {
  return toArray(data)
    .map((d) => (isObj(d) ? num(d.id) : num(d)))
    .filter((n) => n > 0)
}

/** 重算某节点的全部 client.links（inbound 变更后调用）。
 *  s-ui 的约定：client.inbounds 是 id 数组，client.links 是 {remark,type,uri} 数组，
 *  其中 type=local 的由服务端按入站重算，external/sub 的原样保留。 */
async function recomputeLinks(db: D1Database, nodeId: string, fallbackHost: string): Promise<void> {
  const clients = await listObjects(db, nodeId, 'clients')
  const inbounds = await listObjects(db, nodeId, 'inbounds')
  const tlsList = await listObjects(db, nodeId, 'tls')
  const tlsById = new Map(tlsList.map((t) => [num(t.id), t]))
  const inboundById = new Map(inbounds.map((i) => [num(i.id), i]))

  const idsOfClient = (c: J): number[] =>
    (Array.isArray(c.inbounds) ? c.inbounds : [])
      .map((x) => (typeof x === 'number' ? x : num(o(x).id)))
      .filter((n) => n > 0)

  const stmts = []
  for (const c of clients) {
    const ids = idsOfClient(c)
    const existing = Array.isArray(c.links) ? c.links.map(o) : []
    const kept = existing.filter((l) => s(l.type) !== 'local')
    const local: J[] = []
    for (const id of ids) {
      const ib = inboundById.get(id)
      if (!ib) continue
      const tls = tlsById.get(num(ib.tls_id)) ?? null
      for (const uri of genLinks(o(c.config), ib, tls, fallbackHost)) {
        local.push({ remark: s(ib.tag), type: 'local', uri })
      }
    }
    const next = { ...c, inbounds: ids, links: [...local, ...kept] }
    stmts.push(
      db
        .prepare('UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?')
        .bind(JSON.stringify(next, null, 2), now(), nodeId, 'clients', num(c.id)),
    )
  }
  if (stmts.length) await batch(db, stmts)
}

async function nextId(db: D1Database, nodeId: string, kind: ObjectKind): Promise<number> {
  const row = await first<{ m: number }>(
    db,
    'SELECT COALESCE(MAX(obj_id), 0) as m FROM objects WHERE node_id = ? AND kind = ?',
    nodeId,
    kind,
  )
  return (row?.m ?? 0) + 1
}

/** 校验 id/tag 唯一性（s-ui 里 tag 是 unique 约束）。 */
async function tagTaken(db: D1Database, nodeId: string, kind: ObjectKind, tag: string, exceptId: number): Promise<boolean> {
  if (!tag) return false
  const row = await first<{ c: number }>(
    db,
    'SELECT COUNT(*) as c FROM objects WHERE node_id = ? AND kind = ? AND tag = ? AND obj_id <> ?',
    nodeId,
    kind,
    tag,
    exceptId,
  )
  return (row?.c ?? 0) > 0
}

export type SaveResult = { objs: string[] }

/**
 * 保存一个对象，返回需要回传给前端的 object 名列表。
 * action: new | edit | del | set（settings 专用）
 */
export async function saveObject(
  db: D1Database,
  nodeId: string,
  obj: string,
  action: string,
  data: unknown,
  initUsers: string,
  actor: string,
  fallbackHost: string,
): Promise<SaveResult> {
  const stmts = []
  let objs: string[] = [obj]
  const ts = now()

  if (obj === 'config') {
    const payload = isObj(data) ? data : DEFAULT_CONFIG
    stmts.push(
      db
        .prepare(
          "INSERT INTO settings (node_id, key, value) VALUES (?, 'config', ?) ON CONFLICT(node_id, key) DO UPDATE SET value = excluded.value",
        )
        .bind(nodeId, JSON.stringify(payload, null, 2)),
    )
  } else if (obj === 'settings') {
    const map = isObj(data) ? data : {}
    for (const [k, v] of Object.entries(map)) {
      if (k === 'config') continue
      stmts.push(
        db
          .prepare(
            'INSERT INTO settings (node_id, key, value) VALUES (?, ?, ?) ON CONFLICT(node_id, key) DO UPDATE SET value = excluded.value',
          )
          .bind(nodeId, k, typeof v === 'string' ? v : JSON.stringify(v)),
      )
    }
  } else if ((OBJECT_KINDS as readonly string[]).includes(obj)) {
    const kind = obj as ObjectKind

    if (action === 'del') {
      const ids = idsOf(data)
      for (const id of ids) {
        stmts.push(db.prepare('DELETE FROM objects WHERE node_id = ? AND kind = ? AND obj_id = ?').bind(nodeId, kind, id))
      }
      // 解除引用：删 inbound 时清 clients.inbounds；删 tls 时清 inbounds.tls_id
      if (kind === 'inbounds') {
        const clients = await listObjects(db, nodeId, 'clients')
        for (const c of clients) {
          const refs = (Array.isArray(c.inbounds) ? c.inbounds : []).map((x) =>
            typeof x === 'number' ? x : num(o(x).id),
          )
          const kept = refs.filter((r) => !ids.includes(r))
          if (kept.length !== refs.length) {
            stmts.push(
              db
                .prepare('UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?')
                .bind(JSON.stringify({ ...c, inbounds: kept }, null, 2), ts, nodeId, 'clients', num(c.id)),
            )
          }
        }
      }
      if (kind === 'tls') {
        const inbounds = await listObjects(db, nodeId, 'inbounds')
        for (const ib of inbounds) {
          if (ids.includes(num(ib.tls_id))) {
            stmts.push(
              db
                .prepare('UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?')
                .bind(JSON.stringify({ ...ib, tls_id: 0 }, null, 2), ts, nodeId, 'inbounds', num(ib.id)),
            )
          }
        }
      }
    } else {
      const list = toArray(data).map(o)
      for (const raw of list) {
        // sing-box 不认 transport.type=tcp（那是 UI 概念）。前端默认发 {}，
        // 但外部调用/导入数据可能带 tcp，这里统一清掉，避免节点渲染时报错。
        const item = { ...raw }
        const tr = o(item.transport)
        if (s(tr.type) === 'tcp') item.transport = {}
        const editId = num(item.id)
        const isNew = action === 'new' || editId <= 0
        const id = isNew ? await nextId(db, nodeId, kind) : editId
        const tag = s(item.tag) || s(item.name)
        if (await tagTaken(db, nodeId, kind, tag, id)) {
          throw new Error(`duplicate tag: ${tag}`)
        }
        const payload = { ...item, id }
        stmts.push(
          db
            .prepare(
              'INSERT INTO objects (node_id, kind, obj_id, tag, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
                'ON CONFLICT(node_id, kind, obj_id) DO UPDATE SET tag = excluded.tag, data = excluded.data, updated_at = excluded.updated_at',
            )
            .bind(nodeId, kind, id, tag, JSON.stringify(payload, null, 2), ts),
        )
        // 新建 inbound 时把 initUsers 指定的 client 挂上去
        if (kind === 'inbounds' && isNew && initUsers) {
          const want = initUsers.split(',').map((x) => parseInt(x, 10)).filter((n) => n > 0)
          const clients = await listObjects(db, nodeId, 'clients')
          for (const c of clients) {
            if (!want.includes(num(c.id))) continue
            const refs = (Array.isArray(c.inbounds) ? c.inbounds : []).map((x) =>
              typeof x === 'number' ? x : num(o(x).id),
            )
            refs.push(id)
            stmts.push(
              db
                .prepare('UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?')
                .bind(JSON.stringify({ ...c, inbounds: refs }, null, 2), ts, nodeId, 'clients', num(c.id)),
            )
          }
        }
      }
      if (kind === 'tls') objs = ['tls', 'clients', 'inbounds']
      if (kind === 'inbounds') objs = ['inbounds', 'clients']
    }
  } else {
    throw new Error(`unknown object: ${obj}`)
  }

  stmts.push(logChange(db, nodeId, actor, obj, action, data))
  stmts.push(bumpRevision(db, nodeId))
  await batch(db, stmts)

  // 关联数据变了就重算链接（部署规模小，全量重算最稳）
  if (obj === 'inbounds' || obj === 'clients' || obj === 'tls') {
    await recomputeLinks(db, nodeId, fallbackHost)
  }
  return { objs }
}

/** 保存后回传给前端的对象数据（对应 s-ui 的 LoadPartialData）。 */
export async function loadPartial(db: D1Database, nodeId: string, objs: string[]): Promise<J> {
  const out: J = {}
  for (const name of objs) {
    if (name === 'config') out.config = await getConfig(db, nodeId)
    else if (name === 'inbounds') {
      const [ib, cl] = await Promise.all([listObjects(db, nodeId, 'inbounds'), listObjects(db, nodeId, 'clients')])
      out.inbounds = hydrateUsers(ib, cl)
    } else if ((OBJECT_KINDS as readonly string[]).includes(name)) out[name] = await listObjects(db, nodeId, name as ObjectKind)
    else if (name === 'settings') out.settings = await getSettings(db, nodeId)
  }
  return out
}

/** 删除节点时清空其所有数据。 */
export async function purgeNodeData(db: D1Database, nodeId: string): Promise<void> {
  await batch(db, [
    db.prepare('DELETE FROM objects WHERE node_id = ?').bind(nodeId),
    db.prepare('DELETE FROM settings WHERE node_id = ?').bind(nodeId),
    db.prepare('DELETE FROM changes WHERE node_id = ?').bind(nodeId),
    db.prepare('DELETE FROM usage WHERE node_id = ?').bind(nodeId),
    db.prepare('DELETE FROM commands WHERE node_id = ?').bind(nodeId),
  ])
}

/** 建节点时复制一份默认配置，避免新节点面板空白。 */
export async function seedNode(db: D1Database, nodeId: string): Promise<void> {
  const ts = now()
  await batch(db, [
    db
      .prepare(
        "INSERT INTO settings (node_id, key, value) VALUES (?, 'config', ?) ON CONFLICT(node_id, key) DO UPDATE SET value = excluded.value",
      )
      .bind(nodeId, JSON.stringify(DEFAULT_CONFIG, null, 2)),
    // route.final 指向 direct，节点上必须有这个出站，否则内核起不来
    // （对应 s-ui 初始化时自动写入的默认出站）。
    db
      .prepare(
        'INSERT INTO objects (node_id, kind, obj_id, tag, data, updated_at) VALUES (?, ?, 1, ?, ?, ?) ' +
          'ON CONFLICT(node_id, kind, obj_id) DO NOTHING',
      )
      .bind(nodeId, 'outbounds', 'direct', JSON.stringify({ id: 1, type: 'direct', tag: 'direct' }, null, 2), ts),
  ])
}
