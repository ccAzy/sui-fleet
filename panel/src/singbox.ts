// sing-box 客户端订阅：把分享链接转成 outbound 数组（可直接导入 sing-box 系客户端）。
// 解析复用 clash.ts 的 linkToProxy（已经处理了各协议的 URI 细节），这里只做字段映射，
// 避免同一个 URI 出现两套解析逻辑。
import { linkToProxy } from './clash'

type J = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : parseInt(String(v ?? 0), 10) || 0)
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {})

function transportOf(p: J): J | undefined {
  const network = str(p.network) || 'tcp'
  if (network === 'ws') {
    const ws = obj(p['ws-opts'])
    const headers = obj(ws.headers)
    return {
      type: 'ws',
      path: str(ws.path) || '/',
      ...(headers.Host ? { headers: { Host: str(headers.Host) } } : {}),
    }
  }
  if (network === 'grpc') {
    const grpc = obj(p['grpc-opts'])
    return { type: 'grpc', service_name: str(grpc['grpc-service-name']) }
  }
  if (network === 'http') {
    const http = obj(p['http-opts'])
    return { type: 'http', path: str(Array.isArray(http.path) ? http.path[0] : http.path) || '/' }
  }
  return undefined
}

function tlsOf(p: J): J | undefined {
  if (!p.tls) return undefined
  const reality = obj(p['reality-opts'])
  const tls: J = { enabled: true }
  if (p.servername || p.sni) tls.server_name = str(p.servername ?? p.sni)
  if (p['skip-cert-verify']) tls.insecure = true
  if (Array.isArray(p.alpn) && p.alpn.length) tls.alpn = p.alpn
  if (p['client-fingerprint']) {
    tls.utls = { enabled: true, fingerprint: str(p['client-fingerprint']) }
  }
  if (reality['public-key']) {
    tls.reality = {
      enabled: true,
      public_key: str(reality['public-key']),
      ...(reality['short-id'] ? { short_id: str(reality['short-id']) } : {}),
    }
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' }
  }
  return tls
}

/** 一条分享链接 → sing-box outbound；不认识返回 null。 */
export function linkToOutbound(uri: string): J | null {
  const p = linkToProxy(uri)
  if (!p) return null

  const base: J = { tag: str(p.name), server: str(p.server), server_port: num(p.port) }
  const transport = transportOf(p)
  const tls = tlsOf(p)

  switch (str(p.type)) {
    case 'vless':
      return {
        type: 'vless',
        ...base,
        uuid: str(p.uuid),
        ...(p.flow ? { flow: str(p.flow) } : {}),
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
      }
    case 'vmess':
      return {
        type: 'vmess',
        ...base,
        uuid: str(p.uuid),
        security: 'auto',
        alter_id: num(p.alterId),
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
      }
    case 'trojan':
      return {
        type: 'trojan',
        ...base,
        password: str(p.password),
        ...(tls ?? { tls: { enabled: true } } ? { tls: tls ?? { enabled: true } } : {}),
        ...(transport ? { transport } : {}),
      }
    case 'ss':
      return {
        type: 'shadowsocks',
        ...base,
        method: str(p.cipher),
        password: str(p.password),
      }
    case 'hysteria2': {
      const out: J = { type: 'hysteria2', ...base, password: str(p.password) }
      if (tls) out.tls = tls
      if (p.obfs) out.obfs = { type: str(p.obfs), password: str(p['obfs-password']) }
      if (p.up) out.up_mbps = num(p.up)
      if (p.down) out.down_mbps = num(p.down)
      return out
    }
    case 'tuic': {
      const out: J = {
        type: 'tuic',
        ...base,
        uuid: str(p.uuid),
        password: str(p.password),
      }
      if (tls) out.tls = tls
      if (p['congestion-controller']) out.congestion_control = str(p['congestion-controller'])
      return out
    }
    case 'anytls':
      return {
        type: 'anytls',
        ...base,
        password: str(p.password),
        ...(tls ? { tls } : {}),
      }
    default:
      return null
  }
}

/** 生成可以直接喂给 sing-box 客户端的 outbound 数组。 */
export function buildSingboxOutbounds(uris: string[]): J[] {
  const out: J[] = []
  const seen = new Set<string>()
  for (const uri of uris) {
    const o = linkToOutbound(uri)
    if (!o) continue
    let tag = str(o.tag)
    let i = 2
    while (seen.has(tag)) tag = `${o.tag} ${i++}`
    seen.add(tag)
    o.tag = tag
    out.push(o)
  }
  return out
}
