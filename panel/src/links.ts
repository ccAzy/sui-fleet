// 链接生成：按 s-ui util/genLink.go 的规则移植（vless/vmess/trojan/ss/hy2/tuic/anytls/socks/http）。
// 用途：面板里 client.links 展示 + 订阅输出。
type J = Record<string, unknown>

const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v)
const o = (v: unknown): J => (isObj(v) ? v : {})
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : parseInt(String(v ?? 0), 10) || 0)
const bool = (v: unknown): boolean => v === true

/** 按路径取字符串值，路径上任何非对象都当空处理。 */
function path(root: unknown, ...keys: string[]): string {
  let cur: unknown = root
  for (const k of keys) {
    if (!isObj(cur)) return ''
    cur = cur[k]
  }
  return s(cur)
}

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function withParams(uri: string, params: Array<[string, string]>, remark: string, rawKeys: string[] = []): string {
  const parts: string[] = []
  for (const [k, v] of params) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${k}=${rawKeys.includes(k) ? v : encodeURIComponent(v)}`)
  }
  try {
    const url = new URL(uri)
    url.search = parts.join('&')
    if (remark) url.hash = remark
    return url.toString()
  } catch {
    const q = parts.length ? `?${parts.join('&')}` : ''
    const h = remark ? `#${encodeURIComponent(remark)}` : ''
    return `${uri}${q}${h}`
  }
}

/** TLS 段：合并 tls 表的 server 配置与 client 配置。 */
function clientTls(tls: J | null): J | null {
  if (!tls) return null
  const server = o(tls.server)
  const client = o(tls.client)
  const out: J = { ...client, enabled: server.enabled }
  if (server.server_name) out.server_name = server.server_name
  if (server.alpn) out.alpn = server.alpn
  const reality = o(server.reality)
  if (bool(reality.enabled)) {
    const outReality: J = { ...o(client.reality), enabled: true }
    const sids = reality.short_id
    if (Array.isArray(sids) && sids.length) outReality.short_id = sids[Math.floor(Math.random() * sids.length)]
    out.reality = outReality
  }
  return out
}

function tlsParams(tls: J, insecureKey: string): Array<[string, string]> {
  const p: Array<[string, string]> = []
  const reality = o(tls.reality)
  if (bool(reality.enabled)) {
    p.push(['security', 'reality'])
    if (reality.public_key) p.push(['pbk', s(reality.public_key)])
    if (reality.short_id) p.push(['sid', s(reality.short_id)])
  } else {
    p.push(['security', 'tls'])
    if (bool(tls.insecure)) p.push([insecureKey, '1'])
    if (bool(tls.disable_sni)) p.push(['disable_sni', '1'])
  }
  const fp = path(tls, 'utls', 'fingerprint')
  if (fp) p.push(['fp', fp])
  if (tls.server_name) p.push(['sni', s(tls.server_name)])
  if (Array.isArray(tls.alpn) && tls.alpn.length) p.push(['alpn', tls.alpn.map(s).join(',')])
  return p
}

function transportParams(transport: unknown): Array<[string, string]> {
  const t = o(transport)
  const type = s(t.type) || 'tcp'
  const p: Array<[string, string]> = [['type', type]]
  if (type === 'tcp') return p
  if (type === 'http') {
    if (Array.isArray(t.host) && t.host.length) p.push(['host', t.host.map(s).join(',')])
    if (t.path) p.push(['path', s(t.path)])
  } else if (type === 'ws') {
    if (t.path) p.push(['path', s(t.path)])
    const host = path(t, 'headers', 'Host')
    if (host) p.push(['host', host])
  } else if (type === 'grpc') {
    if (t.service_name) p.push(['serviceName', s(t.service_name)])
  } else if (type === 'httpupgrade') {
    if (t.host) p.push(['host', s(t.host)])
    if (t.path) p.push(['path', s(t.path)])
  }
  return p
}

type Addr = { server: string; server_port: number; remark: string; tls: J | null }

function buildAddrs(inbound: J, tls: J | null, fallbackHost: string): Addr[] {
  const raw = Array.isArray(inbound.addrs) ? inbound.addrs.map(o) : []
  const ct = clientTls(tls)
  if (raw.length === 0) {
    return [
      {
        server: fallbackHost,
        server_port: num(inbound.listen_port),
        remark: s(inbound.tag),
        tls: ct,
      },
    ]
  }
  return raw.map((a) => ({
    server: s(a.server),
    server_port: num(a.server_port),
    remark: `${s(inbound.tag)}${s(a.remark)}`,
    tls: ct ? { ...ct, ...o(a.tls) } : null,
  }))
}

function mport(inbound: J): string {
  const ports = o(inbound.out_json).server_ports
  if (Array.isArray(ports) && ports.length) return ports.map(s).join(',')
  return ''
}

/**
 * 生成某客户端在某入站上的全部分享链接。
 * @param userConfig client.config，形如 {"vless":{"uuid":"..."}}
 */
export function genLinks(userConfig: J, inbound: J, tls: J | null, fallbackHost: string): string[] {
  const addrs = buildAddrs(inbound, tls, fallbackHost)
  const type = s(inbound.type)
  const links: string[] = []

  for (const a of addrs) {
    const hostPort = `${a.server}:${a.server_port}`
    switch (type) {
      case 'vless': {
        const uuid = path(userConfig, 'vless', 'uuid')
        const params = transportParams(inbound.transport)
        if (a.tls && bool(a.tls.enabled)) {
          params.push(...tlsParams(a.tls, 'allowInsecure'))
          const flow = path(userConfig, 'vless', 'flow')
          if (flow) params.push(['flow', flow])
        }
        links.push(withParams(`vless://${uuid}@${hostPort}`, params, a.remark, ['alpn']))
        break
      }
      case 'vmess': {
        const uuid = path(userConfig, 'vmess', 'uuid')
        const t = transportParams(inbound.transport)
        const obj: J = { v: '2', id: uuid, aid: 0, add: a.server, port: String(a.server_port), ps: a.remark }
        const net = t.find(([k]) => k === 'type')?.[1] || 'tcp'
        obj.net = net === 'http' ? 'tcp' : net
        if (net === 'http') obj.type = 'http'
        const host = t.find(([k]) => k === 'host')?.[1]
        const p = t.find(([k]) => k === 'path')?.[1]
        if (host) obj.host = host
        if (p) obj.path = p
        if (a.tls && bool(a.tls.enabled)) {
          obj.tls = 'tls'
          for (const [k, v] of tlsParams(a.tls, 'allowInsecure')) {
            if (k === 'allowInsecure') obj.allowInsecure = 1
            else if (k === 'sni') obj.sni = v
            else if (k === 'fp') obj.fp = v
            else if (k === 'alpn') obj.alpn = v
          }
        } else {
          obj.tls = 'none'
        }
        links.push(`vmess://${b64(JSON.stringify(obj))}`)
        break
      }
      case 'trojan': {
        const password = path(userConfig, 'trojan', 'password')
        const params = transportParams(inbound.transport)
        if (a.tls && bool(a.tls.enabled)) params.push(...tlsParams(a.tls, 'allowInsecure'))
        links.push(withParams(`trojan://${password}@${hostPort}`, params, a.remark, ['alpn']))
        break
      }
      case 'shadowsocks': {
        const method = s(inbound.method)
        const parts: string[] = []
        if (method.startsWith('2022')) parts.push(s(inbound.password))
        parts.push(path(userConfig, 'shadowsocks', 'password'))
        const frag = a.remark ? `#${encodeURIComponent(a.remark)}` : ''
        links.push(`ss://${b64(`${method}:${parts.join(':')}`)}@${hostPort}${frag}`)
        break
      }
      case 'hysteria2': {
        const password = path(userConfig, 'hysteria2', 'password')
        const params: Array<[string, string]> = []
        if (inbound.up_mbps) params.push(['downmbps', s(inbound.up_mbps)])
        if (inbound.down_mbps) params.push(['upmbps', s(inbound.down_mbps)])
        if (a.tls) params.push(...tlsParams(a.tls, 'insecure'))
        const obfs = o(inbound.obfs)
        if (obfs.type) {
          params.push(['obfs', s(obfs.type)])
          if (obfs.password) params.push(['obfs-password', s(obfs.password)])
        }
        params.push(['fastopen', bool(inbound.tcp_fast_open) ? '1' : '0'])
        const mp = mport(inbound)
        if (mp) params.push(['mport', mp])
        links.push(withParams(`hysteria2://${password}@${hostPort}`, params, a.remark, ['alpn', 'mport']))
        break
      }
      case 'tuic': {
        const uuid = path(userConfig, 'tuic', 'uuid')
        const password = path(userConfig, 'tuic', 'password')
        const params: Array<[string, string]> = []
        if (a.tls) params.push(...tlsParams(a.tls, 'insecure'))
        if (inbound.congestion_control) params.push(['congestion_control', s(inbound.congestion_control)])
        links.push(withParams(`tuic://${uuid}:${password}@${hostPort}`, params, a.remark, ['alpn']))
        break
      }
      case 'anytls': {
        const password = path(userConfig, 'anytls', 'password')
        const params: Array<[string, string]> = []
        if (a.tls) params.push(...tlsParams(a.tls, 'insecure'))
        links.push(withParams(`anytls://${password}@${hostPort}`, params, a.remark, ['alpn']))
        break
      }
      case 'socks': {
        const u = path(userConfig, 'socks', 'username')
        const p = path(userConfig, 'socks', 'password')
        const frag = a.remark ? `#${encodeURIComponent(a.remark)}` : ''
        links.push(`socks5://${u}:${p}@${hostPort}${frag}`)
        break
      }
      case 'http': {
        const u = path(userConfig, 'http', 'username')
        const p = path(userConfig, 'http', 'password')
        const scheme = a.tls ? 'https' : 'http'
        const frag = a.remark ? `#${encodeURIComponent(a.remark)}` : ''
        links.push(`${scheme}://${u}:${p}@${hostPort}${frag}`)
        break
      }
      case 'mixed': {
        const u = path(userConfig, 'socks', 'username') || path(userConfig, 'http', 'username')
        const p = path(userConfig, 'socks', 'password') || path(userConfig, 'http', 'password')
        const frag = a.remark ? `#${encodeURIComponent(a.remark)}` : ''
        links.push(`socks5://${u}:${p}@${hostPort}${frag}`)
        links.push(`${a.tls ? 'https' : 'http'}://${u}:${p}@${hostPort}${frag}`)
        break
      }
      default:
        break
    }
  }
  return links
}

export const LINK_TYPES = new Set([
  'socks',
  'http',
  'mixed',
  'shadowsocks',
  'hysteria',
  'hysteria2',
  'anytls',
  'tuic',
  'vless',
  'trojan',
  'vmess',
])
