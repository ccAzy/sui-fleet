// 顺位仲裁者：Cloudflare Worker + Cron，唯一负责"判定主控死没死"和"改 DNS"。
//
// 为什么不让节点自己判断：两台候选机各自判断必然出现双方都认为自己是主控（脑裂），
// 比不切换更糟。这里由 CF 作为唯一仲裁者，它看到的是外网视角，且只有它能改 DNS。
//
// 默认 DRY_RUN=1：只记录"如果切换会切到谁"，不动 DNS、不推进代次。
// 确认跑顺之后把 DRY_RUN 改成 0 才真正接管。
import { decide, normalizeOrder, type ArbiterState } from './decide.ts'

export interface Env {
  STATE: KVNamespace
  /** 顺位表，逗号分隔，例如 "hk,jp" */
  ORDER: string
  /** 被探测的健康检查地址（指向当前主控的域名） */
  PROBE_URL: string
  /** 面板基址（用于写回 epoch / primary） */
  PANEL_URL: string
  /** 运维令牌（与备份同源，见 panel/src/auth.verifyOpsToken） */
  OPS_TOKEN: string
  /** Cloudflare API 令牌（需要 Zone.DNS 编辑权限）；DRY_RUN=1 时不需要 */
  CF_API_TOKEN?: string
  ZONE_ID?: string
  RECORD_NAME?: string
  DRY_RUN?: string
  THRESHOLD?: string
  COOLDOWN_MS?: string
}

const DEFAULT_STATE: ArbiterState = { epoch: 0, failures: 0, lastSwitchAt: 0 }

async function probeOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'user-agent': 'sui-arbiter' },
    })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}

async function pushState(env: Env, state: ArbiterState, decision: string, detail: string) {
  await env.STATE.put('state', JSON.stringify(state))
  const log = ((await env.STATE.get('log', 'json')) as Array<Record<string, unknown>> | null) ?? []
  log.unshift({ at: new Date().toISOString(), decision, detail, epoch: state.epoch })
  await env.STATE.put('log', JSON.stringify(log.slice(0, 50)))
}

/** 改 DNS：把记录指向顺位里的下一台（host → IP 的映射放在 KV.ips）。 */
async function switchDns(env: Env, to: string): Promise<string> {
  if ((env.DRY_RUN ?? '1') === '1') return `dry-run：本应切到 ${to}`
  if (!env.CF_API_TOKEN || !env.ZONE_ID || !env.RECORD_NAME) {
    return '缺少 CF_API_TOKEN / ZONE_ID / RECORD_NAME，未改 DNS'
  }
  const ips = ((await env.STATE.get('ips', 'json')) as Record<string, string> | null) ?? {}
  const ip = ips[to]
  if (!ip) return `没有 ${to} 的 IP 映射（KV.ips）`

  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records?name=${encodeURIComponent(env.RECORD_NAME)}`,
    { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } },
  )
  const list = (await listRes.json()) as { result?: Array<{ id: string; content: string }> }
  const rec = list.result?.[0]
  if (!rec) return `DNS 记录 ${env.RECORD_NAME} 不存在`
  if (rec.content === ip) return `已是 ${ip}，无需改动`

  const patch = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records/${rec.id}`,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: ip, ttl: 60 }),
    },
  )
  return patch.ok ? `DNS 已切到 ${to} (${ip})` : `DNS 修改失败 HTTP ${patch.status}`
}

async function reportToPanel(env: Env, epoch: number, primary: string, order: string[], reason: string) {
  try {
    const res = await fetch(`${env.PANEL_URL}/api/arbiter?token=${env.OPS_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ epoch, primary, order, reason }),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok ? '已回写面板' : `回写面板失败 HTTP ${res.status}`
  } catch (err) {
    return `回写面板异常：${err instanceof Error ? err.message : String(err)}`
  }
}

/** 一轮判定。抽成独立函数，便于 scheduled 统一捕获错误写进 KV。 */
async function tick(env: Env): Promise<void> {
  const state = ((await env.STATE.get('state', 'json')) as ArbiterState | null) ?? DEFAULT_STATE
  const order = normalizeOrder((env.ORDER ?? '').split(','))
  const ok = await probeOk(env.PROBE_URL)
  const currentPrimary = order[0] ?? ''

  const decision = decide(state, {
    probeOk: ok,
    currentPrimary,
    order,
    now: Date.now(),
    threshold: Number(env.THRESHOLD ?? 3),
    cooldownMs: Number(env.COOLDOWN_MS ?? 600000),
  })

  if (decision.action === 'switch') {
    const dns = await switchDns(env, decision.to)
    const panel = await reportToPanel(env, decision.state.epoch, decision.to, order, decision.reason)
    await pushState(env, decision.state, 'switch', `${decision.reason}；${dns}；${panel}`)
    return
  }
  if (decision.action === 'exhausted') {
    await pushState(env, decision.state, 'exhausted', '顺位表里没有可用的备选')
    return
  }
  await pushState(
    env,
    decision.state,
    decision.action,
    ok ? '探活正常' : `探活失败 ${decision.state.failures} 次`,
  )
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    try {
      await tick(env)
      await env.STATE.delete('lastError')
    } catch (err) {
      // 没有 tail 的环境里靠这条把错误留在 KV，GET / 能直接看到
      await env.STATE.put(
        'lastError',
        JSON.stringify({
          at: new Date().toISOString(),
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? (err.stack ?? '').slice(0, 500) : '',
        }),
      )
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return new Response('bad request', { status: 400 })
    }
    if (url.searchParams.get('token') !== env.OPS_TOKEN) {
      return new Response('unauthorized', { status: 401 })
    }
    const state = ((await env.STATE.get('state', 'json')) as ArbiterState | null) ?? DEFAULT_STATE
    const log = ((await env.STATE.get('log', 'json')) as unknown[] | null) ?? []
    const lastError = (await env.STATE.get('lastError', 'json')) as unknown
    return Response.json({
      dry_run: (env.DRY_RUN ?? '1') === '1',
      order: normalizeOrder((env.ORDER ?? '').split(',')),
      probe_url: env.PROBE_URL,
      state,
      last_error: lastError,
      log,
    })
  },
}
