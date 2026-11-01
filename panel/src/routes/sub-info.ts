// 聚合订阅地址：客户端只存一个 URL，加/退节点时自动增减，不用重新导入。
//
// 原始订阅散落在每个节点的弹窗里，用户很难自己拼出 /sub/all?k=... 这个地址，
// 所以单独给一个接口，把三种格式的地址一次返回，前端做成一个「订阅」按钮。
import type { Hono } from "hono";
import { json } from "../http";
import type { Env } from "../db";
import { metaGet, metaSet } from "../kernel";

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

/** 聚合订阅密钥：32 hex。首次使用时自动生成——之前全仓只有读取方，导致这个功能永远是死的。 */
async function ensureAggKey(db: Env["DB"]): Promise<string> {
  const cur = await metaGet(db, "agg_key");
  if (cur) return cur;
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const key = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  await metaSet(db, "agg_key", key);
  return key;
}

export function registerSubInfo(app: Hono<{ Bindings: Env }>) {
  app.get("/api/sub-info", async (c) => {
    // 缺密钥就当场生成。这一步必须放在登录守卫之后（本文件在 registerSubInfo
    // 里注册于 /api/* 守卫之后），所以只有管理员能触发。
    const key = await ensureAggKey(c.env.DB);

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

  // 轮换聚合订阅密钥：泄露后不用手工改库（原来唯一的“办法”是直接 UPDATE meta）。
  app.post("/api/sub-info/rotate", async (c) => {
    const raw = crypto.getRandomValues(new Uint8Array(16));
    const key = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    await metaSet(c.env.DB, "agg_key", key);
    return json(c, { ok: true, key });
  });
}
