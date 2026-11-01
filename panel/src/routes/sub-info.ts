// 聚合订阅地址：客户端只存一个 URL，加/退节点时自动增减，不用重新导入。
//
// 原始订阅散落在每个节点的弹窗里，用户很难自己拼出 /sub/all?k=... 这个地址，
// 所以单独给一个接口，把三种格式的地址一次返回，前端做成一个「订阅」按钮。
import type { Hono } from "hono";
import { json } from "../http";
import type { Env } from "../db";
import { metaGet } from "../kernel";

/**
 * 面板对外地址：优先用请求的 host（Caddy 会透传 Host 头），
 * 只有在本机回环访问（定时任务、健康检查）时才退化到 PANEL_BASE。
 */
function publicBase(rawUrl: string, fallback: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.host && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u.host)) {
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    // 解析失败就退化
  }
  return fallback.replace(/\/+$/, "");
}

export function registerSubInfo(app: Hono<{ Bindings: Env }>) {
  app.get("/api/sub-info", async (c) => {
    const key = await metaGet(c.env.DB, "agg_key");
    if (!key) return json(c, { ok: false, reason: "no_agg_key" });

    const base = publicBase(c.req.url, c.env.PANEL_BASE ?? "");
    if (!base) return json(c, { ok: false, reason: "no_base" });

    const mk = (q: string) => `${base}/sub/all?k=${key}${q}`;
    return json(c, {
      ok: true,
      key,
      base,
      urls: {
        clash: mk("&format=clash"),
        singbox: mk("&format=singbox"),
        plain: mk(""),
      },
    });
  });
}
