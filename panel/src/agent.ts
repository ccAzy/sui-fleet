// 节点侧接口：pull（取期望配置 + 指令）与 report（上报状态 + 用量）。
// 认证用 agent token（库里只存 sha256），节点永远主动出站，面板不需要能连到节点。
import type { D1Database } from "@cloudflare/workers-types";
import { sha256 } from "./auth";
import {
  all,
  batch,
  first,
  getNodeByTokenHash,
  logChange,
  now,
  run,
  type NodeRow,
  type ObjectRow,
} from "./db";
import { getConfig, listObjects } from "./objects";

export async function authAgent(
  db: D1Database,
  token: string,
): Promise<NodeRow | null> {
  if (!token) return null;
  const node = await getNodeByTokenHash(db, await sha256(token));
  if (!node || !node.enabled) return null;
  return node;
}

type Cmd = { id: number; kind: string; payload: string };

// 上一个节点记 usage 变更的时间（模块内存，冷启动丢失也无所谓：
// 这只是一条“面板该刷新了”的提示，不是业务数据）。
const USAGE_LOG_INTERVAL = 300;
const lastUsageLog = new Map<string, number>();
function shouldLogUsage(nodeId: string, ts: number): boolean {
  const last = lastUsageLog.get(nodeId) ?? 0;
  if (ts - last < USAGE_LOG_INTERVAL) return false;
  lastUsageLog.set(nodeId, ts);
  return true;
}

/** 拉取期望状态。返回 null 表示版本未变且无指令（节点不用重载）。 */
export async function pullPayload(
  db: D1Database,
  node: NodeRow,
  clientRev: number,
): Promise<J | null> {
  const cmds = await all<Cmd>(
    db,
    // 只取 pending：一旦下发就标 sent，否则节点重启后会反复拿到同一条指令
    // （实测 update_agent 会因此陷入"更新→重启→再更新"的循环）
    "SELECT id, kind, payload FROM commands WHERE node_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 20",
    node.id,
  );
  if (clientRev === node.revision && cmds.length === 0) return null;

  // 注意：Cloudflare 规定**每个请求最多 6 个同时出站连接**（D1 连接也算）。
  // 原来这里一口气 Promise.all 8 个查询，平时能跑通是因为查询都很轻，但 D1 变慢时会
  // 排队失败/超时，而且极难复现。拆成两轮，每轮 4 个，既不超连接数也不丢并发。
  const [config, clients, tls, inbounds] = await Promise.all([
    getConfig(db, node.id),
    listObjects(db, node.id, "clients"),
    listObjects(db, node.id, "tls"),
    listObjects(db, node.id, "inbounds"),
  ]);
  const [outbounds, endpoints, services, settings] = await Promise.all([
    listObjects(db, node.id, "outbounds"),
    listObjects(db, node.id, "endpoints"),
    listObjects(db, node.id, "services"),
    all<{ key: string; value: string }>(
      db,
      "SELECT key, value FROM settings WHERE node_id = ? AND key <> 'config'",
      node.id,
    ),
  ]);

  // 标记为 sent（节点下次 report 里回执 done/failed）
  if (cmds.length) {
    await batch(
      db,
      cmds.map((c) =>
        db
          .prepare(
            "UPDATE commands SET status = 'sent' WHERE id = ? AND status = 'pending'",
          )
          .bind(c.id),
      ),
    );
  }

  return {
    revision: node.revision,
    node: { id: node.id, name: node.name },
    config,
    settings: Object.fromEntries(settings.map((x) => [x.key, x.value])),
    inbounds,
    outbounds,
    endpoints,
    services,
    tls,
    clients,
    commands: cmds.map((c) => ({
      id: c.id,
      kind: c.kind,
      payload: safeParse(c.payload),
    })),
  };
}

type J = Record<string, unknown>;
type CmdPayload = Record<string, unknown>;
function safeParse(s: string): CmdPayload {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as CmdPayload)
      : {};
  } catch {
    return {};
  }
}

export type ReportBody = {
  revision_applied?: number;
  agent_version?: string;
  kernel_version?: string;
  core_state?: string;
  uptime?: number;
  status?: Record<string, unknown>;
  traffic?: Array<{ tag?: string; name?: string; up?: number; down?: number }>;
  commands?: Array<{ id: number; ok: boolean; error?: string }>;
  last_log?: string;
};

/** 处理上报：状态、流量增量、指令回执。 */
export async function handleReport(
  db: D1Database,
  node: NodeRow,
  body: ReportBody,
  ip: string,
): Promise<void> {
  const ts = now();
  const status = body.status ?? {};
  if (body.last_log) status.last_log = body.last_log;

  const stmts = [
    db
      .prepare(
        "UPDATE nodes SET last_seen = ?, last_ip = ?, agent_ver = ?, kernel_ver = ?, core_state = ?, status_json = ?, applied_rev = ? WHERE id = ?",
      )
      .bind(
        ts,
        ip,
        body.agent_version ?? node.agent_ver,
        body.kernel_version ?? node.kernel_ver,
        body.core_state ?? node.core_state,
        JSON.stringify({
          ...status,
          uptime: body.uptime ?? status.uptime ?? 0,
        }),
        body.revision_applied ?? node.applied_rev,
        node.id,
      ),
  ];

  // 流量增量落库 + 累加到对应 client
  const traffic = body.traffic ?? [];
  if (traffic.length) {
    for (const t of traffic) {
      const tag = t.tag ?? t.name ?? "";
      if (!tag) continue;
      stmts.push(
        db
          .prepare(
            "INSERT INTO usage (node_id, ts, tag, up, down) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            node.id,
            ts,
            tag,
            Math.max(0, t.up ?? 0),
            Math.max(0, t.down ?? 0),
          ),
      );
    }
    // 累加客户端计数（一次查询取回，内存里算）
    const clients = await listObjects(db, node.id, "clients");
    const byName = new Map(clients.map((c) => [String(c.name), c]));
    for (const t of traffic) {
      const tag = t.tag ?? t.name ?? "";
      const c = byName.get(tag);
      if (!c) continue;
      const up = Math.max(0, t.up ?? 0);
      const down = Math.max(0, t.down ?? 0);
      const next = {
        ...c,
        up: (Number(c.up) || 0) + up,
        down: (Number(c.down) || 0) + down,
        totalUp: (Number(c.totalUp) || 0) + up,
        totalDown: (Number(c.totalDown) || 0) + down,
      };
      byName.set(tag, next);
      stmts.push(
        db
          .prepare(
            "UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?",
          )
          .bind(
            JSON.stringify(next, null, 2),
            ts,
            node.id,
            "clients",
            Number(c.id),
          ),
      );
    }
  }

  // 流量变了要让面板刷新，但这不是"配置变更"——不能 bump revision，
  // 否则节点每 60 秒都会重新拉一遍全量配置。
  // 也不能每轮都记：这是 D1 写配额的最大单一消耗（约 1.4 万行/天），还会把 changes 表撑大。
  // 面板轮询只需要"知道有变化"，所以每节点 5 分钟最多记一条（模块内存节流，不额外读库）。
  if (traffic.length && shouldLogUsage(node.id, ts)) {
    stmts.push(
      logChange(db, node.id, "", "usage", "report", { count: traffic.length }),
    );
  }

  for (const c of body.commands ?? []) {
    stmts.push(
      db
        .prepare(
          "UPDATE commands SET status = ?, result = ?, done_at = ? WHERE id = ? AND node_id = ?",
        )
        .bind(c.ok ? "done" : "failed", c.error ?? "", ts, c.id, node.id),
    );
  }

  await batch(db, stmts);
}

/** 面板下发指令（重启内核 / 停内核 / 踢用户 / 重置流量）。 */
export async function enqueueCommand(
  db: D1Database,
  nodeId: string,
  kind: string,
  payload: unknown,
  actor: string,
): Promise<number> {
  const res = await run(
    db,
    "INSERT INTO commands (node_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
    nodeId,
    kind,
    JSON.stringify(payload ?? {}),
    now(),
  );
  await batch(db, [logChange(db, nodeId, actor, "command", kind, payload)]);
  return Number(res.meta?.last_row_id ?? 0);
}

export async function pendingCommands(
  db: D1Database,
  nodeId: string,
): Promise<number> {
  const row = await first<{ c: number }>(
    db,
    "SELECT COUNT(*) as c FROM commands WHERE node_id = ? AND status IN ('pending','sent')",
    nodeId,
  );
  return row?.c ?? 0;
}

export type { NodeRow, ObjectRow };
