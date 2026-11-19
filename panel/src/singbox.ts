// sing-box 客户端订阅：把分享链接转成 outbound 数组（可直接导入 sing-box 系客户端）。
// 解析复用 clash.ts 的 linkToProxy（已经处理了各协议的 URI 细节），这里只做字段映射，
// 避免同一个 URI 出现两套解析逻辑。
import { linkToProxy } from "./clash";

type J = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number =>
  typeof v === "number" ? v : parseInt(String(v ?? 0), 10) || 0;
const obj = (v: unknown): J =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {};

function transportOf(p: J): J | undefined {
  const network = str(p.network) || "tcp";
  if (network === "ws") {
    const ws = obj(p["ws-opts"]);
    const headers = obj(ws.headers);
    return {
      type: "ws",
      path: str(ws.path) || "/",
      ...(headers.Host ? { headers: { Host: str(headers.Host) } } : {}),
    };
  }
  if (network === "grpc") {
    const grpc = obj(p["grpc-opts"]);
    return { type: "grpc", service_name: str(grpc["grpc-service-name"]) };
  }
  if (network === "http") {
    const http = obj(p["http-opts"]);
    return {
      type: "http",
      path: str(Array.isArray(http.path) ? http.path[0] : http.path) || "/",
    };
  }
  return undefined;
}

function tlsOf(p: J): J | undefined {
  if (!p.tls) return undefined;
  const reality = obj(p["reality-opts"]);
  const tls: J = { enabled: true };
  if (p.servername || p.sni) tls.server_name = str(p.servername ?? p.sni);
  if (p["skip-cert-verify"]) tls.insecure = true;
  if (Array.isArray(p.alpn) && p.alpn.length) tls.alpn = p.alpn;
  if (p["client-fingerprint"]) {
    tls.utls = { enabled: true, fingerprint: str(p["client-fingerprint"]) };
  }
  if (reality["public-key"]) {
    tls.reality = {
      enabled: true,
      public_key: str(reality["public-key"]),
      ...(reality["short-id"] ? { short_id: str(reality["short-id"]) } : {}),
    };
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: "chrome" };
  }
  return tls;
}

/** 一条分享链接 → sing-box outbound；不认识返回 null。 */
export function linkToOutbound(uri: string): J | null {
  const p = linkToProxy(uri);
  if (!p) return null;

  const base: J = {
    tag: str(p.name),
    server: str(p.server),
    server_port: num(p.port),
  };
  const transport = transportOf(p);
  // hysteria2 / tuic / anytls 是「TLS 原生」协议：clash.ts 为了 Clash 的语义没有给它们设 `tls`
  // 标记（Clash 里这两种类型本身就走 TLS），但 sing-box 的 outbound 必须显式带 tls ——
  // 漏了之后 share link 里的 `insecure=1` / `sni` 全部丢失，生成的 outbound 证书校验必然失败；
  // 更严重的是整份配置会因这两个 outbound 不合法而加载失败，表现出来就是「订阅里只有几个节点」。
  const TLS_NATIVE = new Set(["hysteria2", "tuic", "anytls", "trojan"]);
  const tls = tlsOf(
    TLS_NATIVE.has(str(p.type)) && !p.tls ? { ...p, tls: true } : p,
  );

  switch (str(p.type)) {
    case "vless":
      return {
        type: "vless",
        ...base,
        uuid: str(p.uuid),
        ...(p.flow ? { flow: str(p.flow) } : {}),
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
      };
    case "vmess":
      return {
        type: "vmess",
        ...base,
        uuid: str(p.uuid),
        security: "auto",
        alter_id: num(p.alterId),
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
      };
    case "trojan":
      return {
        type: "trojan",
        ...base,
        password: str(p.password),
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
      };
    case "ss":
      return {
        type: "shadowsocks",
        ...base,
        method: str(p.cipher),
        password: str(p.password),
      };
    case "hysteria2": {
      const out: J = { type: "hysteria2", ...base, password: str(p.password) };
      if (tls) out.tls = tls;
      if (p.obfs)
        out.obfs = { type: str(p.obfs), password: str(p["obfs-password"]) };
      if (p.up) out.up_mbps = num(p.up);
      if (p.down) out.down_mbps = num(p.down);
      return out;
    }
    case "tuic": {
      const out: J = {
        type: "tuic",
        ...base,
        uuid: str(p.uuid),
        password: str(p.password),
      };
      if (tls) out.tls = tls;
      if (p["congestion-controller"])
        out.congestion_control = str(p["congestion-controller"]);
      return out;
    }
    case "anytls":
      return {
        type: "anytls",
        ...base,
        password: str(p.password),
        ...(tls ? { tls } : {}),
      };
    // links.ts 会给 socks / mixed 入站生成 socks5://，给 http 入站生成 http(s)://。
    // 原来 sing-box 侧没有这两个 case → 这些节点在 ?format=singbox 订阅里静默消失。
    case "socks5":
    case "socks":
      return {
        type: "socks",
        ...base,
        ...(p.username ? { username: str(p.username) } : {}),
        ...(p.password ? { password: str(p.password) } : {}),
      };
    case "http":
    case "https":
      return {
        type: "http",
        ...base,
        ...(p.username ? { username: str(p.username) } : {}),
        ...(p.password ? { password: str(p.password) } : {}),
        ...(tls ? { tls } : {}),
      };
    default:
      return null;
  }
}

/** 生成可以直接喂给 sing-box 客户端的 outbound 数组。 */
/**
 * 生成一份**完整**的 sing-box 配置，而不是裸 outbounds 数组。
 *
 * 裸数组只有自己做后处理的客户端能用；标准 remote profile 期望的是一份可加载的
 * 配置对象。这里给出最小可用形态：本地 mixed 入站 + 一个 selector 指向全部节点
 * + direct 兜底。用户导入后即可用，也可以只取其中的 outbounds。
 */
export function buildSingboxConfig(uris: string[], title: string): J {
  const outbounds = buildSingboxOutbounds(uris);
  const tags = outbounds.map((o) => String(o.tag)).filter(Boolean);
  // 自动优选 / 故障转移，与 clash.ts 里的 AUTO / FALLBACK 对齐。
  // 原来只有 selector（只能手动选），长连接场景没得选。
  if (tags.length > 0) {
    outbounds.push({
      type: "urltest",
      tag: "auto",
      outbounds: tags,
      url: "https://www.gstatic.com/generate_204",
      // 10m + 80ms 容差：默认 3m 且无容差，差 1ms 就切，流式响应会断
      interval: "10m",
      tolerance: 80,
    } as J);
    outbounds.push({
      type: "fallback",
      tag: "fallback",
      outbounds: tags,
      url: "https://www.gstatic.com/generate_204",
      interval: "5m",
    } as J);
  }
  outbounds.push({
    type: "selector",
    tag: "proxy",
    outbounds: tags.length ? ["auto", "fallback", ...tags] : ["direct"],
    default: tags.length ? "auto" : "direct",
  } as J);
  outbounds.push({ type: "direct", tag: "direct" } as J);
  return {
    log: { level: "info" },
    inbounds: [
      {
        type: "mixed",
        tag: "mixed-in",
        listen: "127.0.0.1",
        listen_port: 2080,
      },
    ],
    outbounds,
    route: { rules: [], final: "proxy" },
    experimental: { cache_file: { enabled: true, path: "cache.db" } },
    remarks: title,
  } as J;
}

export function buildSingboxOutbounds(uris: string[]): J[] {
  const out: J[] = [];
  const seen = new Set<string>();
  for (const uri of uris) {
    const o = linkToOutbound(uri);
    if (!o) continue;
    let tag = str(o.tag);
    let i = 2;
    while (seen.has(tag)) tag = `${o.tag} ${i++}`;
    seen.add(tag);
    o.tag = tag;
    out.push(o);
  }
  return out;
}
