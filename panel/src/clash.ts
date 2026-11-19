// Clash / mihomo 订阅输出。
// 数据来源就是面板已经生成的分享链接（links.ts），这里只做 URI → Clash proxy 的翻译，
// 避免再维护一份协议字段映射。解析失败的条目直接跳过，不会污染整份订阅。

type Proxy = Record<string, unknown>;

function b64decode(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function num(v: string | null, fallback = 0): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function splitHostPort(hostport: string): { host: string; port: number } {
  const idx = hostport.lastIndexOf(":");
  if (idx < 0) return { host: hostport, port: 0 };
  return { host: hostport.slice(0, idx), port: num(hostport.slice(idx + 1)) };
}

function nameOf(u: URL, fallback: string): string {
  const h = decodeURIComponent(u.hash.replace(/^#/, ""));
  return h || fallback;
}

/** 单条分享链接 → Clash proxy。不认识就返回 null。 */
/**
 * 下面三个小工具只做「同一个字段的取值 + 赋默认名」。
 *
 * 注意：必须在**原来的位置**调用，不能合并成一次调用——Clash 的 YAML 是按对象
 * 属性插入顺序输出的，挪动位置会让订阅内容对不上（特征化快照会立刻发现）。
 */
const applySni = (
  p: Proxy,
  q: URLSearchParams,
  key: "sni" | "servername" = "sni",
) => {
  const v = q.get("sni");
  if (v) p[key] = v;
};

const applyInsecure = (
  p: Proxy,
  q: URLSearchParams,
  param: "insecure" | "allowInsecure" = "insecure",
) => {
  if (q.get(param) === "1") p["skip-cert-verify"] = true;
};

const applyAlpn = (p: Proxy, q: URLSearchParams) => {
  const v = q.get("alpn");
  if (v) p.alpn = String(v).split(",").filter(Boolean);
};


/**
 * sip002 的 base64 userinfo 可能含 `/`，而 URL 解析器会把第一个 `/` 当路径分隔：
 * `ss://ab/cd==@h:443` → host 变成 `ab`，节点直接丢失。
 * 把 authority 段（最后一个 @ 之前）里的 `/` 预先转义，解析回来还是原 base64。
 */
function normalizeSSLink(uri: string): string {
  const m = /^(ss|shadowsocks):\/\//i.exec(uri);
  if (!m) return uri;
  const rest = uri.slice(m[0].length);
  let cut = rest.length;
  const q = rest.search(/[?#]/);
  if (q >= 0) cut = q;
  const head = rest.slice(0, cut);
  const at = head.lastIndexOf("@");
  if (at < 0) return uri;
  const userinfo0 = head.slice(0, at);
  if (!userinfo0.includes("/")) return uri;
  return `${m[0]}${userinfo0.split("/").join("%2F")}${head.slice(at)}${rest.slice(cut)}`;
}

export function linkToProxy(uri: string): Proxy | null {
  try {
    if (uri.startsWith("vmess://")) {
      const raw = b64decode(uri.slice("vmess://".length));
      const j = JSON.parse(raw) as Record<string, string>;
      const proxy: Proxy = {
        name: j.ps || `${j.add}:${j.port}`,
        type: "vmess",
        server: j.add,
        port: num(j.port),
        uuid: j.id,
        alterId: num(j.aid, 0),
        cipher: "auto",
        udp: true,
      };
      if (j.tls === "tls") {
        proxy.tls = true;
        if (j.sni) proxy.servername = j.sni;
        if (j.fp) proxy["client-fingerprint"] = j.fp;
        if (j.alpn) proxy.alpn = j.alpn.split(",").filter(Boolean);
        // vmess 里的 allowInsecure 可能是字符串 "1"，也可能是数字 1（s-ui 自己生成时写的是数字）
        const insecure = j.allowInsecure as unknown;
        if (insecure === "1" || insecure === 1)
          proxy["skip-cert-verify"] = true;
      }
      applyTransport(proxy, j.net || "tcp", j.host, j.path);
      return proxy;
    }

    const u = new URL(normalizeSSLink(uri));
    const q = u.searchParams;
    const { host, port } = splitHostPort(u.host);
    const name = nameOf(u, host);

    switch (u.protocol.replace(":", "")) {
      case "vless": {
        const proxy: Proxy = {
          name,
          type: "vless",
          server: host,
          port,
          uuid: decodeURIComponent(u.username),
          udp: true,
        };
        const security = q.get("security") ?? "none";
        if (security === "reality") {
          proxy.tls = true;
          proxy["client-fingerprint"] = q.get("fp") ?? "chrome";
          const pbk = q.get("pbk");
          const sid = q.get("sid");
          if (pbk)
            proxy["reality-opts"] = {
              "public-key": pbk,
              ...(sid ? { "short-id": sid } : {}),
            };
          applySni(proxy, q, "servername");
        } else if (security === "tls") {
          proxy.tls = true;
          applySni(proxy, q, "servername");
          applyInsecure(proxy, q, "allowInsecure");
          if (q.get("fp")) proxy["client-fingerprint"] = q.get("fp");
        }
        if (q.get("flow")) proxy.flow = q.get("flow");
        applyAlpn(proxy, q);
        applyTransport(
          proxy,
          q.get("type") ?? "tcp",
          q.get("host"),
          q.get("path"),
          q.get("serviceName"),
        );
        return proxy;
      }
      case "trojan": {
        const proxy: Proxy = {
          name,
          type: "trojan",
          server: host,
          port,
          password: decodeURIComponent(u.username),
          udp: true,
        };
        applySni(proxy, q);
        applyInsecure(proxy, q, "allowInsecure");
        applyAlpn(proxy, q);
        applyTransport(
          proxy,
          q.get("type") ?? "tcp",
          q.get("host"),
          q.get("path"),
        );
        return proxy;
      }
      case "ss": {
        const decoded = b64decode(decodeURIComponent(u.username));
        const idx = decoded.indexOf(":");
        const cipher = decoded.slice(0, idx);
        const password = decoded.slice(idx + 1);
        return {
          name,
          type: "ss",
          server: host,
          port,
          cipher,
          password,
          udp: true,
        };
      }
      case "hysteria2": {
        const proxy: Proxy = {
          name,
          type: "hysteria2",
          server: host,
          port,
          password: decodeURIComponent(u.username),
          udp: true,
        };
        applySni(proxy, q);
        applyInsecure(proxy, q);
        if (q.get("obfs")) proxy.obfs = q.get("obfs");
        if (q.get("obfs-password"))
          proxy["obfs-password"] = q.get("obfs-password");
        if (q.get("upmbps")) proxy.up = q.get("upmbps");
        if (q.get("downmbps")) proxy.down = q.get("downmbps");
        if (q.get("mport")) proxy.ports = q.get("mport");
        applyAlpn(proxy, q);
        return proxy;
      }
      case "tuic": {
        const proxy: Proxy = {
          name,
          type: "tuic",
          server: host,
          port,
          uuid: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
          udp: true,
        };
        applySni(proxy, q);
        applyAlpn(proxy, q);
        if (q.get("congestion_control"))
          proxy["congestion-controller"] = q.get("congestion_control");
        applyInsecure(proxy, q);
        return proxy;
      }
      case "anytls": {
        const proxy: Proxy = {
          name,
          type: "anytls",
          server: host,
          port,
          password: decodeURIComponent(u.username),
          udp: true,
        };
        applySni(proxy, q);
        applyInsecure(proxy, q);
        return proxy;
      }
      case "socks5":
      case "socks": {
        // links.ts 会给 socks / mixed 入站生成 socks5:// 链接，原来这里不认识 →
        // Clash 与 sing-box 订阅里静默少一批节点（不报错，用户以为没配）。
        const proxy: Proxy = {
          name,
          type: "socks5",
          server: host,
          port,
          udp: true,
        };
        if (u.username) proxy.username = decodeURIComponent(u.username);
        if (u.password) proxy.password = decodeURIComponent(u.password);
        // socks5/http 链接不带 transport 参数，按默认 tcp 处理即可
        applyTransport(
          proxy,
          q.get("type") ?? "tcp",
          q.get("host"),
          q.get("path"),
        );
        return proxy;
      }
      case "http":
      case "https": {
        const proxy: Proxy = {
          name,
          type: "http",
          server: host,
          port,
        };
        if (u.username) proxy.username = decodeURIComponent(u.username);
        if (u.password) proxy.password = decodeURIComponent(u.password);
        const scheme = u.protocol.replace(":", "");
        if (scheme === "https" || q.get("tls") === "1") {
          proxy.tls = true;
          applySni(proxy, q, "servername");
        }
        return proxy;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function applyTransport(
  proxy: Proxy,
  type: string,
  host?: string | null,
  path?: string | null,
  serviceName?: string | null,
): void {
  switch (type) {
    case "ws":
      proxy.network = "ws";
      proxy["ws-opts"] = {
        path: path || "/",
        ...(host ? { headers: { Host: host } } : {}),
      };
      break;
    case "grpc":
      proxy.network = "grpc";
      proxy["grpc-opts"] = { "grpc-service-name": serviceName || "" };
      break;
    case "http":
      proxy.network = "http";
      proxy["http-opts"] = {
        path: [path || "/"],
        ...(host ? { headers: { Host: [host] } } : {}),
      };
      break;
    case "httpupgrade":
      proxy.network = "ws";
      proxy["ws-opts"] = {
        path: path || "/",
        "v2ray-http-upgrade": true,
        ...(host ? { headers: { Host: host } } : {}),
      };
      break;
    default:
      proxy.network = "tcp";
      break;
  }
}

// YAML 会把「数字样子」的字符串自动转型（"50e9" → 5e10 浮点、"0123" → 八进制、"true" → 布尔），
// 而 Clash/Karing 这些客户端拿到 double 会直接报错把整条节点丢掉：
//   type 'double' is not a subtype of type 'String?'  … short-id: 50000000000.0
// 实测就是 REALITY 的 short-id 恰好是 `50e9`（50×10⁹）惹的祸。所以凡是被 YAML 认成非字符串的都要加引号。
const YAML_SPECIAL = /[:#{}[\],&*?|<>=!%@`"']/;
const YAML_BOOL_NULL = /^(true|false|null|yes|no|on|off|y|n|~)$/i;
// 整数 / 浮点 / 科学计数，例如 1e5、50e9、1.2e-3 —— 这些都会被 YAML 当数字
const YAML_NUMBER = /^[+-]?(?:\d[\d_]*\.?[\d_]*|\.\d+)(?:[eE][+-]?\d+)?$/;
// 八进制 / 十六进制 / 二进制 / .inf / .nan
const YAML_OTHER_NUM =
  /^(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|[+-]?\.(?:inf|nan))$/i;

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  // 需要引号的场景：含 YAML 特殊字符、以特殊符号开头、可被误判为数字/布尔
  const needsQuote =
    YAML_SPECIAL.test(s) ||
    YAML_BOOL_NULL.test(s) ||
    YAML_NUMBER.test(s) ||
    YAML_OTHER_NUM.test(s) ||
    s.trim() !== s ||
    s === "";
  return needsQuote ? JSON.stringify(s) : s;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const inner = toYaml(item, indent + 1);
          return `${pad}- ${inner.trimStart()}`;
        }
        return `${pad}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([k, v]) => {
        if (Array.isArray(v) && v.length === 0) return `${pad}${k}: []`;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        if (Array.isArray(v)) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${yamlScalar(v)}`;
      })
      .join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
}

/** 把一组分享链接渲染成一份可直接导入 Clash/mihomo 的配置。 */
export function buildClashConfig(uris: string[], title = "s-ui"): string {
  const proxies: Proxy[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const uri of uris) {
    const p = linkToProxy(uri);
    if (!p) continue;
    let name = String(p.name);
    let i = 2;
    while (seen.has(name)) name = `${p.name} ${i++}`;
    seen.add(name);
    p.name = name;
    proxies.push(p);
    names.push(name);
  }

  const doc: Record<string, unknown> = {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    "external-controller": "127.0.0.1:9090",
    proxies,
    "proxy-groups": [
      { name: "PROXY", type: "select", proxies: [...names, "DIRECT"] },
      {
        name: "AUTO",
        type: "url-test",
        proxies: names,
        url: "https://www.gstatic.com/generate_204",
        // interval 300 + tolerance 0 是默认组合，也是最坑的组合：
        // 每 5 分钟重测全量，且相差 1ms 就切换 —— 正在跑的流式响应/下载当场断。
        // 600s 重测 + 80ms 容差，小幅抖动不再触发切换。
        interval: 600,
        tolerance: 80,
      },
      {
        // 长连接场景用它：只按顺序用第一个活着的，不追最快，不会中途切走
        name: "FALLBACK",
        type: "fallback",
        proxies: names,
        url: "https://www.gstatic.com/generate_204",
        interval: 300,
      },
    ],
    rules: ["GEOIP,CN,DIRECT", "MATCH,PROXY"],
  };

  return `# ${title}\n# generated by s-ui cloud panel\n${toYaml(doc)}\n`;
}
