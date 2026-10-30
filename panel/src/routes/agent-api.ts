// 节点侧接口：/agent/pull、/agent/report
//
// 这两条是"控制面 → 数据面"的唯一入口，鉴权走 bearer token（库里只存 sha256）。
// 从 index.ts 拆出来后，改节点协议不用碰面板的业务路由。
import type { Hono } from "hono";
import type { Env, NodeRow } from "../db";
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
    );
    if (!payload)
      return c.json({ ok: true, unchanged: true, revision: node.revision });
    return c.json({ ok: true, unchanged: false, ...payload });
  });

  app.post("/agent/report", async (c) => {
    const node = await agentNode(c);
    if (!node) return c.json({ ok: false, error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as ReportBody;
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
