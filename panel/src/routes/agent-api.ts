// 节点侧接口：/agent/pull、/agent/report
//
// 这两条是"控制面 → 数据面"的唯一入口，鉴权走 bearer token（库里只存 sha256）。
// 从 index.ts 拆出来后，改节点协议不用碰面板的业务路由。
import type { Hono } from "hono";
import type { Env, NodeRow } from "../db";
import { AgentReportBody, tryDecode } from "../schema";
import {
  authAgent,
  handleReport,
  pendingCommands,
  pullPayload,
  type ReportBody,
} from "../agent";

function bearer(c: any): string {
  const h = c.req.header("Authorization") ?? "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return c.req.header("X-Agent-Token") ?? "";
}

async function agentNode(c: any): Promise<NodeRow | null> {
  return await authAgent(c.env.DB, bearer(c));
}

export function registerAgentApi(app: Hono<{ Bindings: Env }>) {
  app.post("/agent/pull", async (c) => {
    const node = await agentNode(c);
    if (!node) return c.json({ ok: false, error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      revision?: number;
    };
    const payload = await pullPayload(
      c.env.DB,
      node,
      Number(body.revision ?? 0),
      String((body as { hash?: string }).hash ?? ""),
    );
    if (!payload)
      return c.json({ ok: true, unchanged: true, revision: node.revision });
    return c.json({ ok: true, unchanged: false, ...payload });
  });

  app.post("/agent/report", async (c) => {
    const node = await agentNode(c);
    if (!node) return c.json({ ok: false, error: "unauthorized" }, 401);
    const raw = await c.req.json().catch(() => ({}));
    // 先按「已解析的领域值」收下：之后 handleReport 里就不必再 typeof 一遍。
    // 注意顺序：先截断 traffic，再校验，避免 2 万条的正常上报被判成非法。
    const MAX_TRAFFIC_TOTAL = 10_000;
    if (raw && Array.isArray(raw.traffic) && raw.traffic.length > MAX_TRAFFIC_TOTAL)
      raw.traffic = raw.traffic.slice(0, MAX_TRAFFIC_TOTAL);
    const decoded = tryDecode(AgentReportBody, raw);
    if (!decoded.ok)
      return c.json(
        { ok: false, error: `report 校验失败：${decoded.issues.slice(0, 3).join("; ")}` },
        400,
      );
    // SAFETY: AgentReportBody 的字段是 ReportBody 的子集（status/traffic/commands 同形），
    // decode 只做收窄不做转换，所以断言成立；新增字段时两边要同步。
    const body = decoded.data as unknown as ReportBody;
    // 单次上报的流量条目数必须封顶：handleReport 对每条 traffic 追加 INSERT，
    // 并对每个命中 tag 再 UPDATE 一次，写放大约 2N。agent token 属于低权主体，
    // 不能让一次请求就能推动任意多的 D1 写（免费档 10 万/天是全库共享的）。
    await handleReport(
      c.env.DB,
      node,
      body,
      c.req.header("CF-Connecting-IP") ?? "",
    );
    return c.json({
      ok: true,
      pending_commands: await pendingCommands(c.env.DB, node.id),
    });
  });
}
