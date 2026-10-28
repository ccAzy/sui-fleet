// 面板入口：/api/* 兼容 s-ui 前端协议，/agent/* 给节点，/sub/* 订阅出口。
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { COOKIE, ensureAdmin, login as doLogin, sha256, signJWT, verifyJWT } from './auth'
import {
  all,
  first,
  getNode,
  listNodes,
  now,
  run,
  type Env,
  type NodeRow,
} from './db'
import {
  changedSince,
  getConfig,
  getSettings,
  loadFull,
  loadPartial,
  purgeNodeData,
  saveObject,
  seedNode,
} from './objects'
import { authAgent, enqueueCommand, handleReport, pendingCommands, pullPayload, type ReportBody } from './agent'
import { cronTick } from './cron'
import { getKernelInfo, isOutdated, metaGet, metaSet } from './kernel'

type Ctx = { Bindings: Env }

const app = new Hono<Ctx>()

// 基础安全响应头（面板自带登录，这几项成本几乎为零）
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
})

// ---------- 基础设施 ----------

/** JWT 秘钥：优先 env，否则在 D1 meta 里生成一次并复用。 */
async function secretOf(env: Env): Promise<string> {
  if (env.JWT_SECRET) return env.JWT_SECRET
  const row = await first<{ value: string }>(env.DB, "SELECT value FROM meta WHERE key = 'jwt_secret'")
  if (row?.value) return row.value
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const secret = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
  await run(env.DB, "INSERT INTO meta (key, value) VALUES ('jwt_secret', ?) ON CONFLICT(key) DO NOTHING", secret)
  return secret
}

interface Session {
  username: string
  mustChange: boolean
  uid: number
}

async function currentUser(c: any): Promise<Session | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const payload = await verifyJWT(token, await secretOf(c.env))
  if (!payload || typeof payload.u !== 'string') return null
  return { username: payload.u, uid: Number(payload.uid ?? 0), mustChange: payload.mc === true }
}

/** 选中的节点：X-Remote-Server 头优先，缺省落到第一个启用节点。 */
async function resolveNode(db: Env['DB'], headerId: string | undefined): Promise<NodeRow | null> {
  if (headerId) return await getNode(db, headerId)
  const nodes = await listNodes(db)
  return nodes.find((n) => n.enabled) ?? null
}

const MARKER_COOKIE = 's-ui'

const json = (c: any, obj: unknown, error?: unknown) =>
  c.json({ success: !error, msg: error ? String((error as Error)?.message ?? error) : '', obj: obj ?? null })

const okMsg = (c: any, msg = '') => c.json({ success: true, msg, obj: null })

function randHex(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- 登录 ----------

app.post('/api/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  const ts = now()
  const recent = await first<{ c: number }>(
    c.env.DB,
    'SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND ts > ? AND ok = 0',
    ip,
    ts - 300,
  )
  if ((recent?.c ?? 0) >= 8) return json(c, null, new Error('too many failed attempts, retry in a few minutes'))

  const body = await c.req.parseBody()
  await ensureAdmin(c.env.DB, c.env.ADMIN_USER, c.env.ADMIN_PASS)
  const user = await doLogin(c.env.DB, String(body.user ?? ''), String(body.pass ?? ''))
  await run(c.env.DB, 'INSERT INTO login_attempts (ip, ts, ok) VALUES (?, ?, ?)', ip, ts, user ? 1 : 0)
  if (!user) return json(c, null, new Error('Invalid login'))
  const mustChange = user.must_change === 1
  const token = await signJWT({ u: user.username, uid: user.id, mc: mustChange }, await secretOf(c.env))
  let isHttps = true
  try {
    isHttps = new URL(c.req.url).protocol === 'https:'
  } catch {
    isHttps = true
  }
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 86400, secure: isHttps })
  // 前端路由守卫读的是 document.cookie 里的 `s-ui`（沿用它原来的名字）。
  // 这个只是"已登录"标记，读得到也无所谓；真正的凭据是上面那个 HttpOnly cookie。
  setCookie(c, MARKER_COOKIE, '1', { httpOnly: false, sameSite: 'Lax', path: '/', maxAge: 86400, secure: isHttps })
  return json(c, { must_change: mustChange })
})

app.get('/api/logout', async (c) => {
  deleteCookie(c, COOKIE, { path: '/' })
  deleteCookie(c, MARKER_COOKIE, { path: '/' })
  return okMsg(c)
})

// ---------- 需要登录的 /api ----------

app.use('/api/*', async (c, next) => {
  const p = c.req.path
  if (p.endsWith('/login') || p.endsWith('/logout')) return await next()
  const session = await currentUser(c)
  if (!session) return json(c, null, new Error('Invalid login'))
  const action = c.req.path.split('/').pop() ?? ''
  if (session.mustChange && !['changePass', 'logout', 'login', 'users', 'changes', 'tokens', 'servers'].includes(action)) {
    return json(c, null, new Error('当前是默认密码，请先到「管理 → 修改密码」改成自己的密码'))
  }
  c.set('user' as never, session.username as never)
  return await next()
})

function baseUrl(c: any): string {
  try {
    return new URL(c.req.url).origin
  } catch {
    return c.env.PANEL_BASE ?? ''
  }
}

app.get('/api/load', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, { config: {}, inbounds: [], outbounds: [], endpoints: [], services: [], clients: [], tls: [], onlines: {}, subURI: '' })
  const lu = c.req.query('lu') ?? ''
  const changed = await changedSince(c.env.DB, node.id, lu)
  const subURI = `${baseUrl(c)}/sub/${node.id}?k=${node.sub_key}`
  if (!changed) {
    return json(c, { onlines: onlinesOf(node) })
  }
  return json(c, await loadFull(c.env.DB, node.id, subURI))
})

app.get('/api/servers', async (c) => {
  const nodes = await listNodes(c.env.DB)
  return json(c, {
    servers: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      url: n.address,
      token: '',
      remark: n.remark,
      enabled: n.enabled,
      last_seen: n.last_seen,
      core_state: n.core_state,
      kernel_ver: n.kernel_ver,
      agent_ver: n.agent_ver,
      revision: n.revision,
      applied_rev: n.applied_rev,
    })),
  })
})

app.get('/api/settings', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, {})
  return json(c, await getSettings(c.env.DB, node.id))
})

app.get('/api/config', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, {})
  return json(c, { config: await getConfig(c.env.DB, node.id) })
})

for (const kind of ['inbounds', 'outbounds', 'endpoints', 'services', 'tls', 'clients'] as const) {
  app.get(`/api/${kind}`, async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
    if (!node) return json(c, { [kind]: [] })
    const data = await loadPartial(c.env.DB, node.id, [kind])
    return json(c, data)
  })
}

app.get('/api/status', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, {})
  const kernel = await getKernelInfo(c.env.DB)
  let status: Record<string, unknown> = {}
  try {
    status = JSON.parse(node.status_json) as Record<string, unknown>
  } catch {
    status = {}
  }
  // 原样透传节点上报的状态对象（cpu / mem / dsk / net / sys / sbd …），
  // 前端的 Gauge / History 组件按 s-ui 的结构读，压平成数字会全部显示 "-/-"。
  const sbd = (status.sbd as Record<string, unknown>) ?? {}
  return json(c, {
    ...status,
    running: node.core_state === 'running',
    // 内核运行态以面板记录的 core_state 为准（节点刚上报时 sbd 可能还没带全）
    sbd: { ...sbd, running: node.core_state === 'running', stats: sbd.stats ?? {} },
    kernel: {
      version: node.kernel_ver,
      latest: kernel.latest,
      outdated: isOutdated(node.kernel_ver, kernel.latest),
      checked_at: kernel.checkedAt,
    },
    agent: { version: node.agent_ver },
  })
})

app.get('/api/onlines', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  return json(c, node ? onlinesOf(node) : { inbound: [], outbound: [], user: [] })
})

function onlinesOf(node: NodeRow) {
  try {
    const st = JSON.parse(node.status_json) as Record<string, unknown>
    const on = (st.onlines ?? {}) as Record<string, unknown>
    return {
      inbound: (on.inbound as string[]) ?? [],
      outbound: (on.outbound as string[]) ?? [],
      user: (on.user as string[]) ?? [],
      // 面板状态页顶部用它判断在线/离线
      last_seen: node.last_seen,
      core_state: node.core_state,
    }
  } catch {
    return { inbound: [], outbound: [], user: [] }
  }
}

app.get('/api/logs', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, [])
  try {
    const st = JSON.parse(node.status_json) as Record<string, unknown>
    return json(c, st.logs ?? [])
  } catch {
    return json(c, [])
  }
})

app.get('/api/changes', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, [])
  const since = parseInt(c.req.query('k') ?? '0', 10) || 0
  const rows = await all<{ ts: number; actor: string; kind: string; action: string; obj: string }>(
    c.env.DB,
    'SELECT ts, actor, kind, action, obj FROM changes WHERE node_id = ? AND ts >= ? ORDER BY id DESC LIMIT 100',
    node.id,
    since,
  )
  return json(c, rows)
})

app.get('/api/updateInfo', async (c) => json(c, { current: 'cf-0.1.0', latest: 'cf-0.1.0' }))

// 管理员列表（Admins 页依赖；lastLogin 必须是字符串，前端会 split）
app.get('/api/users', async (c) => {
  const rows = await all<{ id: number; username: string }>(
    c.env.DB,
    'SELECT id, username FROM users ORDER BY id ASC',
  )
  return json(c, rows.map((r) => ({ id: r.id, username: r.username, lastLogin: '' })))
})

// 第三方调用用的 API Token（面板自用，给脚本/监控取订阅或改配置）
app.get('/api/tokens', async (c) => {
  const session = await currentUser(c)
  if (!session) return json(c, [])
  const rows = await all<{ id: number; desc: string; token: string; expiry: number }>(
    c.env.DB,
    'SELECT id, desc, token, expiry FROM tokens WHERE user_id = ? ORDER BY id DESC',
    session.uid,
  )
  return json(c, rows)
})

app.post('/api/addToken', async (c) => {
  const session = await currentUser(c)
  if (!session) return json(c, null, new Error('Invalid login'))
  const body = await c.req.parseBody()
  const desc = String(body.desc ?? '')
  const expiry = parseInt(String(body.expiry ?? '0'), 10) || 0
  const token = randHex(24)
  await run(
    c.env.DB,
    'INSERT INTO tokens (user_id, desc, token, expiry, created_at) VALUES (?, ?, ?, ?, ?)',
    session.uid,
    desc,
    token,
    expiry,
    now(),
  )
  return json(c, token)
})

app.post('/api/deleteToken', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id ?? '0'), 10)
  if (!id) return json(c, null, new Error('invalid id'))
  await run(c.env.DB, 'DELETE FROM tokens WHERE id = ?', id)
  return okMsg(c)
})

// 前端的"服务器列表"= 这里的受管节点。可达性用 agent 最近一次上报的时间判断，
// 不需要（也不应该）由面板反连节点。
app.get('/api/testServer', async (c) => {
  const id = c.req.query('id') ?? ''
  const node = await getNode(c.env.DB, id)
  if (!node) return json(c, { online: false, error: 'node not found' })
  const age = now() - node.last_seen
  const online = node.last_seen > 0 && age < 180
  return json(c, {
    online,
    latency: online ? Math.max(1, age) : 0,
    error: online ? '' : node.last_seen === 0 ? 'agent 尚未上报过' : `已 ${age}s 未上报`,
  })
})

/** servers 对象映射到 nodes 表（前端的服务器管理页直接可用来建/改/删节点）。 */
async function saveServers(c: any, action: string, data: unknown): Promise<unknown> {
  const d = (data ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const idOf = (v: unknown) =>
    typeof v === 'object' && v !== null ? String((v as Record<string, unknown>).id ?? '') : String(v ?? '')

  if (action === 'del') {
    const id = idOf(d)
    if (id) {
      await purgeNodeData(c.env.DB, id)
      await run(c.env.DB, 'DELETE FROM nodes WHERE id = ?', id)
    }
  } else if (action === 'new' || action === 'edit') {
    const name = str(d.name).trim()
    if (!name) throw new Error('name required')
    const address = str(d.url) || str(d.address)
    const remark = str(d.remark)
    const existingId = str(d.id)
    if (action === 'edit' && existingId) {
      await run(
        c.env.DB,
        'UPDATE nodes SET name = ?, address = ?, remark = ?, updated_at = ? WHERE id = ?',
        name,
        address,
        remark,
        now(),
        existingId,
      )
    } else {
      const id = Math.random().toString(36).slice(2, 8)
      const raw = crypto.getRandomValues(new Uint8Array(24))
      const token = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
      const subKey = randHex(16)
      const ts = now()
      await run(
        c.env.DB,
        'INSERT INTO nodes (id, name, token_hash, address, sub_key, remark, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
        id,
        name,
        await sha256(token),
        address,
        subKey,
        remark,
        ts,
        ts,
      )
      await seedNode(c.env.DB, id)
      // 明文 token 只在这里返回一次，供贴到节点的安装命令里
      return { servers: [{ id, name, url: address, remark, token }] }
    }
  } else {
    throw new Error('unknown action: ' + action)
  }

  const nodes = await listNodes(c.env.DB)
  return {
    servers: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      url: n.address,
      token: '',
      remark: n.remark,
      enabled: n.enabled,
      last_seen: n.last_seen,
      core_state: n.core_state,
      kernel_ver: n.kernel_ver,
      agent_ver: n.agent_ver,
      revision: n.revision,
      applied_rev: n.applied_rev,
    })),
  }
}

app.post('/api/save', async (c) => {
  const body = await c.req.parseBody()
  const obj = String(body.object ?? '')
  const action = String(body.action ?? '')
  let data: unknown = {}
  try {
    data = JSON.parse(String(body.data ?? '{}'))
  } catch {
    return json(c, null, new Error('invalid data json'))
  }

  if (obj === 'servers') {
    try {
      return json(c, await saveServers(c, action, data))
    } catch (e) {
      return json(c, null, e)
    }
  }

  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, null, new Error('no node selected'))
  const actor = (c.get('user' as never) as string) ?? ''
  try {
    const res = await saveObject(
      c.env.DB,
      node.id,
      obj,
      action,
      data,
      String(body.initUsers ?? ''),
      actor,
      node.address || new URL(c.req.url).hostname,
    )
    const partial = await loadPartial(c.env.DB, node.id, res.objs)
    return json(c, partial, undefined)
  } catch (e) {
    return json(c, null, e)
  }
})

app.post('/api/restartSb', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, null, new Error('no node selected'))
  await enqueueCommand(c.env.DB, node.id, 'restart_core', {}, (c.get('user' as never) as string) ?? '')
  return okMsg(c, 'save')
})

app.post('/api/restartApp', async (c) => okMsg(c, 'restartApp'))

app.post('/api/changePass', async (c) => {
  const body = await c.req.parseBody()
  const username = (c.get('user' as never) as string) ?? ''
  const oldPass = String(body.oldPass ?? '')
  const newPass = String(body.newPass ?? '')
  const newName = String(body.newUsername ?? '') || username
  const user = await doLogin(c.env.DB, username, oldPass)
  if (!user) return json(c, null, new Error('Invalid login'))
  const { hashPassword } = await import('./auth')
  await run(
    c.env.DB,
    'UPDATE users SET username = ?, password_hash = ?, must_change = 0 WHERE id = ?',
    newName,
    await hashPassword(newPass),
    user.id,
  )
  // 重签 cookie，让 mc 立刻变 false，不用重新登录
  let https = true
  try {
    https = new URL(c.req.url).protocol === 'https:'
  } catch {
    https = true
  }
  const fresh = await signJWT({ u: newName, uid: user.id, mc: false }, await secretOf(c.env))
  setCookie(c, COOKIE, fresh, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 86400, secure: https })
  return okMsg(c, 'save')
})

// 第三方链接转换：这些需要节点侧内核能力，先明确回错而不是静默成功
app.post('/api/linkConvert', async (c) => json(c, null, new Error('linkConvert 需要节点侧能力，暂未开放')))
app.post('/api/subConvert', async (c) => json(c, null, new Error('subConvert 需要节点侧能力，暂未开放')))

// ---------- 节点管理（servers 语义） ----------

app.post('/api/nodes', async (c) => {
  const body = await c.req.parseBody()
  const name = String(body.name ?? '').trim()
  if (!name) return json(c, null, new Error('name required'))
  const id = Math.random().toString(36).slice(2, 8)
  const raw = crypto.getRandomValues(new Uint8Array(24))
  const token = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
  const ts = now()
  await run(
    c.env.DB,
    'INSERT INTO nodes (id, name, token_hash, address, sub_key, remark, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
    id,
    name,
    await sha256(token),
    String(body.address ?? ''),
    randHex(16),
    String(body.remark ?? ''),
    ts,
    ts,
  )
  await seedNode(c.env.DB, id)
  return json(c, { id, token })
})

app.post('/api/nodes/:id/delete', async (c) => {
  const id = c.req.param('id')
  await purgeNodeData(c.env.DB, id)
  await run(c.env.DB, 'DELETE FROM nodes WHERE id = ?', id)
  return okMsg(c)
})

/* ---------- 节点二进制（含内核）更新 ----------
   面板只存"更新源"（URL + sha256 + 版本），点更新时把这三项随指令下发；
   节点自己下载、校验、原子替换、重启。面板不托管二进制（Workers 单文件 25MB 限制，装不下 73MB）。 */

async function getRelease(db: Env['DB']) {
  return {
    url: await metaGet(db, 'agent_release_url'),
    sha256: await metaGet(db, 'agent_release_sha256'),
    version: await metaGet(db, 'agent_release_version'),
  }
}

app.get('/api/release', async (c) => json(c, await getRelease(c.env.DB)))

app.post('/api/release', async (c) => {
  const body = await c.req.parseBody()
  const url = String(body.url ?? '').trim()
  if (url && !/^https?:\/\//.test(url)) return json(c, null, new Error('url 必须是 http(s) 地址'))
  await metaSet(c.env.DB, 'agent_release_url', url)
  await metaSet(c.env.DB, 'agent_release_sha256', String(body.sha256 ?? '').trim())
  await metaSet(c.env.DB, 'agent_release_version', String(body.version ?? '').trim())
  return json(c, await getRelease(c.env.DB))
})

app.post('/api/nodes/:id/update-agent', async (c) => {
  const id = c.req.param('id')
  const node = await getNode(c.env.DB, id)
  if (!node) return json(c, null, new Error('node not found'))
  const rel = await getRelease(c.env.DB)
  if (!rel.url) {
    return json(c, null, new Error('尚未配置更新源：先在面板设置里填写 agent 分发包 URL 与 sha256'))
  }
  await enqueueCommand(c.env.DB, id, 'update_agent', rel, (c.get('user' as never) as string) ?? '')
  return okMsg(c)
})

// 与 /api/status 一致：不传 id 时作用于当前选中节点（前端 currentServer 为空也能用）
app.post('/api/updateAgent', async (c) => {
  const node = await resolveNode(c.env.DB, c.req.header('X-Remote-Server'))
  if (!node) return json(c, null, new Error('no node selected'))
  const rel = await getRelease(c.env.DB)
  if (!rel.url) {
    return json(c, null, new Error('尚未配置更新源：先填写 agent 分发包 URL 与 sha256'))
  }
  await enqueueCommand(c.env.DB, node.id, 'update_agent', rel, (c.get('user' as never) as string) ?? '')
  return okMsg(c)
})

app.post('/api/nodes/:id/command', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const kind = String(body.kind ?? 'restart_core')
  await enqueueCommand(c.env.DB, id, kind, {}, (c.get('user' as never) as string) ?? '')
  return okMsg(c)
})

// ---------- agent 接口 ----------

function bearer(c: any): string {
  const h = c.req.header('Authorization') ?? ''
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
  return c.req.header('X-Agent-Token') ?? ''
}

async function agentNode(c: any): Promise<NodeRow | null> {
  return await authAgent(c.env.DB, bearer(c))
}

app.post('/agent/pull', async (c) => {
  const node = await agentNode(c)
  if (!node) return c.json({ ok: false, error: 'unauthorized' }, 401)
  const body = (await c.req.json().catch(() => ({}))) as { revision?: number }
  const payload = await pullPayload(c.env.DB, node, Number(body.revision ?? 0))
  if (!payload) return c.json({ ok: true, unchanged: true, revision: node.revision })
  return c.json({ ok: true, unchanged: false, ...payload })
})

app.post('/agent/report', async (c) => {
  const node = await agentNode(c)
  if (!node) return c.json({ ok: false, error: 'unauthorized' }, 401)
  const body = (await c.req.json().catch(() => ({}))) as ReportBody
  await handleReport(c.env.DB, node, body, c.req.header('CF-Connecting-IP') ?? '')
  return c.json({ ok: true, pending_commands: await pendingCommands(c.env.DB, node.id) })
})

// ---------- 订阅 ----------

app.get('/sub/:nodeId', async (c) => {
  const node = await getNode(c.env.DB, c.req.param('nodeId'))
  if (!node || !node.enabled) return c.text('not found', 404)
  const key = c.req.query('k') ?? ''
  if (!node.sub_key || key !== node.sub_key) return c.text('forbidden', 403)
  const clients = await all<{ data: string }>(
    c.env.DB,
    "SELECT data FROM objects WHERE node_id = ? AND kind = 'clients' ORDER BY obj_id",
    node.id,
  )
  const links: string[] = []
  for (const row of clients) {
    try {
      const cl = JSON.parse(row.data) as Record<string, unknown>
      if (cl.enable === false) continue
      const ls = Array.isArray(cl.links) ? (cl.links as unknown[]) : []
      for (const l of ls) {
        if (typeof l === 'string') links.push(l)
        else if (l && typeof l === 'object') {
          const uri = (l as Record<string, unknown>).uri
          if (typeof uri === 'string' && uri) links.push(uri)
        }
      }
    } catch (e) {
      console.warn("skip malformed client row", e)
    }
  }
  const text = links.join('\n')
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
  return c.text(payload, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})

// ---------- 定时任务 ----------

app.all('/__cron', async (c) => {
  await cronTick(c.env.DB)
  return c.text('ok')
})

app.get('/', (c) => c.text('s-ui cloud panel'))

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env) {
    await cronTick(env.DB)
  },
}
