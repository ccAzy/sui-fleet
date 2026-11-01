// 执行器代理（只在自托管面板上有意义）：面板 → 本机 sui-ops → SSH 到目标机跑 promote.sh。
//
// 安全约束：
//   - 这个路由注册在 /api/* 登录守卫之后（与其它写接口同权），未登录进不来；
//   - 目标名只允许白名单字符，且由执行器再做一次白名单校验；
//   - 令牌取本机环境变量 OPS_EXEC_TOKEN，不入数据库、不进备份。
import type { Hono } from "hono";
import { json } from "../http";
import type { Env } from "../db";

type OpsEnv = Env & { OPS_EXEC_TOKEN?: string };

export function registerOps(app: Hono<{ Bindings: Env }>) {
  app.post("/api/ops/promote", async (c) => {
    const target = c.req.query("target") ?? "";
    const dry = c.req.query("dry") === "1" ? "&dry=1" : "";
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(target)) {
      return json(c, null, new Error("invalid target"));
    }
    const token = (c.env as OpsEnv).OPS_EXEC_TOKEN ?? "";
    if (!token) {
      return json(c, null, new Error("未配置 OPS_EXEC_TOKEN（只有自托管面板才有执行器）"));
    }
    try {
      const res = await fetch(
        `http://127.0.0.1:8790/promote?target=${encodeURIComponent(target)}${dry}&token=${token}`,
        { method: "POST", signal: AbortSignal.timeout(600000) },
      );
      return c.text(await res.text(), 200, { "Content-Type": "text/plain; charset=utf-8" });
    } catch (err) {
      return json(
        c,
        null,
        new Error(
          `执行器不可达（面板跑在 Cloudflare 上时属于正常）：${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  });
}
