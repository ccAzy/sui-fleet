// 订阅出口：
//   /sub/:nodeId   —— 单节点订阅（原有行为，保持兼容）
//   /sub/all       —— 聚合订阅：一个地址包含所有启用节点的链接
//
// 聚合订阅是"换服务器不用重发链接"的关键：客户端只保存 /sub/all 一个地址，
// 加减节点后客户端刷新一次就自动增减条目。
import type { Hono } from "hono";
import { all, getNode, listNodes, type Env } from "../db";
import { buildClashConfig, linkToProxy } from "../clash";
import { buildSingboxConfig, linkToOutbound } from "../singbox";

type SubFormat = "" | "clash" | "singbox";

/** 解析订阅 query：兼容老前端把 `?format=xxx` 拼进 k / client 的畸形链接。 */
function parseSubQuery(raw: {
  k?: string;
  client?: string;
  type?: string;
  format?: string;
}) {
  let key = (raw.k ?? "").trim();
  let embedded = "";
  const q1 = key.indexOf("?");
  if (q1 >= 0) {
    embedded = key.slice(q1 + 1);
    key = key.slice(0, q1);
  }

  let clientFilter = (raw.client ?? "").trim();
  const q2 = clientFilter.indexOf("?");
  if (q2 >= 0) {
    if (!embedded) embedded = clientFilter.slice(q2 + 1);
    clientFilter = clientFilter.slice(0, q2).trim();
  }

  const embeddedParams = new URLSearchParams(embedded);
  const fmt = (
    raw.type ??
    raw.format ??
    embeddedParams.get("format") ??
    ""
  ).toLowerCase();

  const subType: SubFormat =
    fmt === "clash" || fmt === "mihomo"
      ? "clash"
      : fmt === "singbox" || fmt === "json"
        ? "singbox"
        : "";

  return { key, clientFilter, subType };
}

/**
 * 统计有多少条链接是目标格式表达不了的。
 *
 * Clash 与 sing-box 的协议覆盖不完全一样（例如 hysteria v1、naive 两边都不支持）。
 * 这类节点原来会**静默消失**——用户在面板里配好了，订阅里却没有，而且没有任何提示。
 * 用响应头把数量带出去，客户端不显示，但用 curl 一看就知道少了几条。
 */
function countUnsupported(links: string[], subType: SubFormat): number {
  let n = 0;
  for (const uri of links) {
    // 两种格式的协议覆盖面不一样（clash.ts 与 singbox.ts 各有一张表），
    // 所以要按目标格式分别统计，不能只看 linkToProxy。
    const ok =
      subType === "singbox"
        ? linkToOutbound(uri) !== null
        : linkToProxy(uri) !== null;
    if (!ok) n += 1;
  }
  return n;
}

/** 三种格式的统一渲染出口。 */
function renderSubscription(
  links: string[],
  title: string,
  headers: Record<string, string>,
  subType: SubFormat,
): Response {
  if (subType === "clash" || subType === "singbox") {
    const skipped = countUnsupported(links, subType);
    if (skipped > 0)
      headers = { ...headers, "X-Sub-Unsupported": String(skipped) };
  }
  if (subType === "clash") {
    return new Response(buildClashConfig(links, title), {
      status: 200,
      headers: { ...headers, "Content-Type": "text/yaml; charset=utf-8" },
    });
  }
  if (subType === "singbox") {
    // 返回完整配置对象（不是裸数组）：标准 remote profile 期望可加载的配置。
    return new Response(
      JSON.stringify(buildSingboxConfig(links, title), null, 2),
      {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }
  const text = links.join(String.fromCharCode(10));
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  return new Response(payload, {
    status: 200,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** 给链接的备注加上节点名前缀，避免多节点聚合后同名条目分不清。 */
function prefixRemark(uri: string, nodeName: string): string {
  const hash = uri.indexOf("#");
  const base = hash >= 0 ? uri.slice(0, hash) : uri;
  const remark = hash >= 0 ? decodeURIComponent(uri.slice(hash + 1)) : "";
  return `${base}#${encodeURIComponent(`${nodeName} · ${remark || "node"}`)}`;
}

function clientHeaders(
  cl: Record<string, unknown> | null,
): Record<string, string> {
  const up = Number(cl?.up ?? 0) || 0;
  const down = Number(cl?.down ?? 0) || 0;
  const total = Number(cl?.volume ?? 0) || 0;
  const expire = Number(cl?.expiry ?? 0) || 0;
  return {
    "Profile-Update-Interval": "12",
    "Subscription-Userinfo": `upload=${up}; download=${down}; total=${total}; expire=${expire}`,
    "Cache-Control": "no-store",
  };
}

function collectLinks(cl: Record<string, unknown>): string[] {
  const out: string[] = [];
  const ls = Array.isArray(cl.links) ? (cl.links as unknown[]) : [];
  for (const l of ls) {
    if (typeof l === "string") out.push(l);
    else if (l && typeof l === "object") {
      const uri = (l as Record<string, unknown>).uri;
      if (typeof uri === "string" && uri) out.push(uri);
    }
  }
  return out;
}

export function registerSub(app: Hono<{ Bindings: Env }>) {
  // ---- 聚合订阅（必须注册在 /sub/:nodeId 之前，否则会被当成 nodeId="all"） ----
  app.get("/sub/all", async (c) => {
    const { key, clientFilter, subType } = parseSubQuery({
      k: c.req.query("k"),
      client: c.req.query("client"),
      type: c.req.query("type"),
      format: c.req.query("format"),
    });

    const row = await all<{ value: string }>(
      c.env.DB,
      "SELECT value FROM meta WHERE key = 'agg_key'",
    );
    const aggKey = row[0]?.value ?? "";
    if (!aggKey) {
      return c.text(
        "aggregate subscription not configured: set meta.agg_key first",
        403,
      );
    }
    if (key !== aggKey) return c.text("forbidden", 403);

    const nodes = await listNodes(c.env.DB);
    const links: string[] = [];
    let up = 0;
    let down = 0;
    let matchedClients = 0;

    // 一次取回所有启用节点的客户端，而不是每个节点查一遍。
    // 原来是 N+1：10 台节点 = 1 次查 meta + 1 次查 nodes + 10 次查 clients，
    // 而客户端每次刷新订阅都会重跑这 12 次查询。
    const enabled = nodes.filter((n) => n.enabled);
    const nameById = new Map(enabled.map((n) => [n.id, n.name]));
    const rows = enabled.length
      ? await all<{ node_id: string; data: string }>(
          c.env.DB,
          `SELECT node_id, data FROM objects WHERE kind = 'clients' AND node_id IN (${enabled
            .map(() => "?")
            .join(", ")}) ORDER BY node_id, obj_id`,
          ...enabled.map((n) => n.id),
        )
      : [];
    for (const r of rows) {
      const nodeName = nameById.get(r.node_id) ?? "";
      let cl: Record<string, unknown>;
      try {
        cl = JSON.parse(r.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (cl.enable === false) continue;
      if (clientFilter && String(cl.name ?? "") !== clientFilter) continue;
      matchedClients++;
      up += Number(cl.up ?? 0) || 0;
      down += Number(cl.down ?? 0) || 0;
      for (const uri of collectLinks(cl))
        links.push(prefixRemark(uri, nodeName));
    }

    if (links.length === 0) {
      return c.text(
        clientFilter
          ? `client not found: ${clientFilter}`
          : "no nodes available",
        404,
        { "Cache-Control": "no-store" },
      );
    }

    return renderSubscription(
      links,
      "s-ui all",
      {
        ...clientHeaders(null),
        // 聚合适配多节点不同配额：不冒充单客户端的 total/expire，只给已用流量
        "Subscription-Userinfo": `upload=${up}; download=${down}; total=0; expire=0`,
        "Profile-Title": encodeURIComponent("s-ui (all)"),
      },
      subType,
    );
  });

  // ---- 单节点订阅（原有行为，保持不变） ----
  app.get("/sub/:nodeId", async (c) => {
    const node = await getNode(c.env.DB, c.req.param("nodeId"));
    if (!node || !node.enabled) return c.text("not found", 404);
    if (!node.sub_key) return c.text("forbidden", 403);

    const {
      key: rawKey,
      clientFilter: parsedClient,
      subType,
    } = parseSubQuery({
      k: c.req.query("k"),
      client: c.req.query("client"),
      type: c.req.query("type"),
      format: c.req.query("format"),
    });

    const clients = await all<{ data: string }>(
      c.env.DB,
      "SELECT data FROM objects WHERE node_id = ? AND kind = 'clients' ORDER BY obj_id",
      node.id,
    );

    // 令牌分支必须排在 k 校验之前：`?t=<sub_token>` 不带 k，
    // 而 k 为空时 startsWith(node.sub_key) 必然为假，会先被 403 挡掉。
    const subToken = (c.req.query("t") ?? "").trim();

    // k 前缀匹配：老前端把 client 名直接拼在 k 后面（`k=<sub_key><clientName>`）
    let clientFilter = parsedClient;
    if (!subToken && rawKey !== node.sub_key) {
      if (!rawKey.startsWith(node.sub_key)) return c.text("forbidden", 403);
      if (!clientFilter)
        clientFilter = rawKey.slice(node.sub_key.length).trim();
    }

    // 每客户端自己的订阅令牌（`?t=<sub_token>`）：链接本身就是凭据，作用域就是这个客户端。
    if (subToken) {
      let matched = "";
      for (const r of clients) {
        try {
          const cl = JSON.parse(r.data) as Record<string, unknown>;
          if (String(cl.sub_token ?? "") === subToken)
            matched = String(cl.name ?? "");
        } catch {
          /* 坏行跳过 */
        }
      }
      if (!matched) return c.text("forbidden", 403);
      clientFilter = matched;
    }

    // 作用域要求 + legacy 收口：
    //   ?t=<sub_token>            正式格式，令牌即作用域
    //   ?k=<sub_key>&client=<名>  兼容格式，**仅当该客户端还没有 sub_token 时**才放行
    //   ?k=<sub_key><名字>        同上（更老的拼接形式）
    // cron 已把所有客户端补上 sub_token，所以 legacy 实际处于关闭状态；保留分支只是
    // 为了不给「刚建好、还没被回填」的客户端留空白窗口。
    if (clientFilter && !subToken) {
      let target: Record<string, unknown> | null = null;
      for (const r of clients) {
        try {
          const cl = JSON.parse(r.data) as Record<string, unknown>;
          if (String(cl.name ?? "") === clientFilter) target = cl;
        } catch {
          /* 坏行跳过 */
        }
      }
      if (target && String(target.sub_token ?? ""))
        return c.text(
          "forbidden: this client has its own subscription token, use ?t=<token>",
          403,
          { "Cache-Control": "no-store" },
        );
    }

    if (!clientFilter && !subToken) {
      return c.text(
        "forbidden: subscription URL must be scoped to one client " +
          "(use ?t=<client sub_token> from the panel, or ?k=<sub_key>&client=<name>)",
        403,
        { "Cache-Control": "no-store" },
      );
    }
    const links: string[] = [];
    let subClient: Record<string, unknown> | null = null;
    for (const r of clients) {
      try {
        const cl = JSON.parse(r.data) as Record<string, unknown>;
        if (cl.enable === false) continue;
        if (clientFilter && String(cl.name ?? "") !== clientFilter) continue;
        if (!subClient) subClient = cl;
        links.push(...collectLinks(cl));
      } catch (e) {
        console.warn("skip malformed client row", e);
      }
    }

    if (links.length === 0 && clientFilter) {
      return c.text(`client not found: ${clientFilter}`, 404, {
        "Cache-Control": "no-store",
      });
    }

    return renderSubscription(
      links,
      node.name || "s-ui",
      {
        ...clientHeaders(subClient),
        "Profile-Title": encodeURIComponent(node.name || "s-ui"),
      },
      subType,
    );
  });
}
