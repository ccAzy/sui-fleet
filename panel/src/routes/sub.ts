// 订阅出口：/sub/:nodeId
//
// 从 index.ts 拆出来——这段最长也最容易改坏（兼容老前端拼错的 URL），
// 单独一个文件后改动面收窄，改它不用再通读一千行入口。
import type { Hono } from "hono";
import { all, getNode, type Env } from "../db";
import { buildClashConfig } from "../clash";
import { buildSingboxOutbounds } from "../singbox";

export function registerSub(app: Hono<{ Bindings: Env }>) {
  app.get("/sub/:nodeId", async (c) => {
    const node = await getNode(c.env.DB, c.req.param("nodeId"));
    if (!node || !node.enabled) return c.text("not found", 404);
    if (!node.sub_key) return c.text("forbidden", 403);

    // 前端 QrCode.vue 一直把 client 名直接拼在 k 后面（`k=<sub_key><clientName>`），
    // 而且 sing-box 那条还会再接一个 `?format=json` —— 于是出现形如
    //   /sub/xxx?k=<sub_key>user-abc?format=clash
    // 的畸形链接：第二个 ? 之后整段都算在 k 里。这里做三件事：
    //   ① k 前缀匹配（多余部分当用户名过滤）② 把 k 里夹带的 ?query 拆出来解析
    //   ③ 兼容 format= 作为 type= 的别名。
    // 这样老链接与正确链接都能用。
    let rawKey = c.req.query("k") ?? "";
    let embeddedQuery = "";
    const qIdx = rawKey.indexOf("?");
    if (qIdx >= 0) {
      embeddedQuery = rawKey.slice(qIdx + 1);
      rawKey = rawKey.slice(0, qIdx);
    }

    let clientFilter = (c.req.query("client") ?? "").trim();
    // 与 k 同理：老前端把 `?format=` 拼在 client 后面，整段会算进 client 值，
    // 导致名字永远匹配不上、静默返回空订阅。这里拆出来。
    const clientQ = clientFilter.indexOf("?");
    if (clientQ >= 0) {
      if (!embeddedQuery) embeddedQuery = clientFilter.slice(clientQ + 1);
      clientFilter = clientFilter.slice(0, clientQ).trim();
    }
    if (rawKey !== node.sub_key) {
      if (!rawKey.startsWith(node.sub_key)) return c.text("forbidden", 403);
      if (!clientFilter)
        clientFilter = rawKey.slice(node.sub_key.length).trim();
    }

    const embedded = new URLSearchParams(embeddedQuery);
    const clients = await all<{ data: string }>(
      c.env.DB,
      "SELECT data FROM objects WHERE node_id = ? AND kind = 'clients' ORDER BY obj_id",
      node.id,
    );
    const links: string[] = [];
    // 订阅头需要 client 级的流量/配额（对齐原版 util.GetHeaders）
    let subClient: Record<string, unknown> | null = null;
    for (const row of clients) {
      try {
        const cl = JSON.parse(row.data) as Record<string, unknown>;
        if (cl.enable === false) continue;
        if (clientFilter && String(cl.name ?? "") !== clientFilter) continue;
        if (!subClient) subClient = cl;
        const ls = Array.isArray(cl.links) ? (cl.links as unknown[]) : [];
        for (const l of ls) {
          if (typeof l === "string") links.push(l);
          else if (l && typeof l === "object") {
            const uri = (l as Record<string, unknown>).uri;
            if (typeof uri === "string" && uri) links.push(uri);
          }
        }
      } catch (e) {
        console.warn("skip malformed client row", e);
      }
    }
    // 订阅协议的标准响应头（原版 subHandler.addHeaders 也是这三个）：
    // 客户端靠 Subscription-Userinfo 显示流量/到期，Profile-Update-Interval 决定自动更新间隔。
    const up = Number(subClient?.up ?? 0) || 0;
    const down = Number(subClient?.down ?? 0) || 0;
    const total = Number(subClient?.volume ?? 0) || 0;
    const expire = Number(subClient?.expiry ?? 0) || 0;
    const subHeaders: Record<string, string> = {
      "Profile-Title": encodeURIComponent(node.name || "s-ui"),
      "Profile-Update-Interval": "12",
      "Subscription-Userinfo": `upload=${up}; download=${down}; total=${total}; expire=${expire}`,
      "Cache-Control": "no-store",
    };

    // 过滤后为空又确实指定了 client：说明名字对不上（拼错/已删除/被禁用）。
    // 直接报 404 并带上名字，避免客户端拿到 200 + 空内容却无从排查。
    if (links.length === 0 && clientFilter) {
      return c.text(`client not found: ${clientFilter}`, 404, {
        "Cache-Control": "no-store",
      });
    }

    // ?type=clash 输出 mihomo/Clash 可直接导入的 YAML；默认仍是 base64 链接列表
    const subType = (
      c.req.query("type") ??
      c.req.query("format") ??
      embedded.get("format") ??
      ""
    ).toLowerCase();
    if (subType === "clash" || subType === "mihomo") {
      return c.text(buildClashConfig(links, node.name), 200, {
        ...subHeaders,
        "Content-Type": "text/yaml; charset=utf-8",
      });
    }
    if (subType === "singbox" || subType === "json") {
      return c.body(
        JSON.stringify(buildSingboxOutbounds(links), null, 2),
        200,
        {
          ...subHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      );
    }

    const text = links.join(String.fromCharCode(10));
    const payload = btoa(
      String.fromCharCode(...new TextEncoder().encode(text)),
    );
    return c.text(payload, 200, {
      ...subHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    });
  });
}
