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
  ensureConfigHashSchema,
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

/** 指令重投窗口：下发后 10 分钟仍无回执才退回 pending（正常慢回执不应被重发）。 */
const COMMAND_RETRY_AFTER = 600;

/** 老库补两列（sent_at / attempts）。ALTER 幂等，每个 isolate 只尝试一次。 */
let commandSchemaReady: Promise<void> | null = null;
function ensureCommandRetrySchema(db: D1Database): Promise<void> {
  if (!commandSchemaReady) {
    commandSchemaReady = (async () => {
      for (const ddl of [
        "ALTER TABLE commands ADD COLUMN sent_at INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE commands ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
      ]) {
        try {
          await run(db, ddl);
        } catch {
          // 列已存在（新库由 schema.sql 建好），忽略
        }
      }
    })();
  }
  return commandSchemaReady;
}

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
/**
 * 稳定序列化：对象按 key 排序，数组保持原序。
 *
 * 指纹必须对「同样的内容」给出同样的值，所以不能直接 JSON.stringify ——
 * 同一个对象经过 SELECT 换序、字段顺序变化后，stringify 的结果就不同了，
 * 会导致「每轮都判定内容变了」→ 节点每 30 秒重启一次内核。
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return (
    "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}"
  );
}

/** 配置指纹：内容相同 → 值相同；revision 相同不代表内容相同。 */
export async function configHashOf(payload: {
  config: unknown;
  settings: unknown;
  inbounds: unknown;
  outbounds: unknown;
  endpoints: unknown;
  services: unknown;
  tls: unknown;
  clients: unknown;
}): Promise<string> {
  return sha256(canonical(payload));
}

/** 指纹过期多久后强制重算一次（秒）。 */
const HASH_RECHECK_SECONDS = 3600;

export async function pullPayload(
  db: D1Database,
  node: NodeRow,
  clientRev: number,
  clientHash = "",
): Promise<J | null> {
  await ensureConfigHashSchema(db);
  // 指令一旦被下发就标成 sent，避免节点重启后反复拿到同一条（update_agent 会因此
  // 陷入“更新→重启→再更新”的死循环）。但这样做有个代价：节点拿到指令后、上报之前
  // 崩了或断网，这条指令就永远停在 sent，没人再发给它。
  // 所以补一条有限重投：超过 10 分钟仍未回执、且重试不到 3 次的，退回 pending。
  await ensureCommandRetrySchema(db);
  await run(
    db,
    `UPDATE commands SET status = 'pending', sent_at = 0, attempts = attempts + 1
      WHERE node_id = ? AND status = 'sent' AND sent_at > 0
        AND sent_at < ? AND attempts < 3`,
    node.id,
    now() - COMMAND_RETRY_AFTER,
  );

  const cmds = await all<Cmd>(
    db,
    // 只取 pending：一旦下发就标 sent，否则节点重启后会反复拿到同一条指令
    // （实测 update_agent 会因此陷入"更新→重启→再更新"的循环）
    "SELECT id, kind, payload FROM commands WHERE node_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 20",
    node.id,
  );
  // ---- 是否需要下发 ----
  //
  // 只比 revision 是不够的：revision 说明「改过几次」，说明不了「内容是什么」。
  // 从备份恢复、把待机机的库 promote 上来、手工改库之后，revision 可能正好等于
  // 节点上的值，而内容已经不同 —— 那样节点会永远收到 unchanged，永远跑旧配置，
  // 而面板上 last_seen / core_state 一切正常，几乎无法察觉。
  //
  // 现在：revision 相同还要看内容指纹。
  //   快路径：库里的指纹未过期且与节点一致 → 直接 unchanged（不查库）
  //   慢路径：指纹过期/为空 → 重算一次；算出来一样就只刷新校验时间，不重启内核
  //
  // 旧版 agent 不发送指纹（clientHash 为空），保持原来的行为，避免升级期每轮全量下发。
  if (clientRev === node.revision && cmds.length === 0) {
    const fresh =
      !!node.config_hash &&
      node.config_hash === clientHash &&
      now() - (node.hash_checked_at || 0) < HASH_RECHECK_SECONDS;
    if (fresh) return null;
    // 已经种子过、只是对端是旧版 agent（不送指纹）→ 保持原来的行为，不折腾它
    if (!clientHash && node.config_hash) return null;
    // 其余情况（首次种子：两边都空 / 指纹不符）落到下面全量算一次：
    // 升级后节点会因此多应用一次配置，换来的是从此具备「内容变了也能发现」的能力。
  }

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

  const settingsMap = Object.fromEntries(settings.map((x) => [x.key, x.value]));
  const hash = await configHashOf({
    config,
    settings: settingsMap,
    inbounds,
    outbounds,
    endpoints,
    services,
    tls,
    clients,
  });
  await run(
    db,
    "UPDATE nodes SET config_hash = ?, hash_checked_at = ? WHERE id = ?",
    hash,
    now(),
    node.id,
  );

  // 算出来和节点上的一样 → 内容其实没变，只是库里的指纹过期了。
  // 这时仍然返回 unchanged，不要为了刷新一次指纹去重启内核。
  if (clientHash && hash === clientHash && clientRev === node.revision && cmds.length === 0)
    return null;

  // 标记为 sent（节点下次 report 里回执 done/failed）；同时记下发时间，供重投判定。
  // 必须在确定要下发之后再标：否则上面判成 unchanged 时会留下「已发送但从未送达」的指令。
  if (cmds.length) {
    const ts = now();
    await batch(
      db,
      cmds.map((c) =>
        db
          .prepare(
            "UPDATE commands SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'pending'",
          )
          .bind(ts, c.id),
      ),
    );
  }

  return {
    revision: node.revision,
    hash,
    node: { id: node.id, name: node.name },
    config,
    settings: settingsMap,
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
  // 节点上报的日志统一落到 status.logs（数组）；last_log 是旧键，继续写一份兼容老前端。
  if (body.last_log) {
    const prev = Array.isArray(status.logs) ? (status.logs as unknown[]) : [];
    status.logs = [...prev, body.last_log].slice(-200);
    status.last_log = body.last_log;
  }

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
  // 只统计 pending 与「还在重投窗口内的 sent」。
  // 原来把全部 sent 都算在途，而重投 3 次用尽后状态会永久停在 sent，
  // 结果是面板永远显示「有未完成指令」，操作员只能删节点才能清掉。
  const row = await first<{ c: number }>(
    db,
    "SELECT COUNT(*) as c FROM commands WHERE node_id = ? AND (status = 'pending' OR (status = 'sent' AND sent_at > ?))",
    nodeId,
    now() - COMMAND_RETRY_AFTER * 3,
  );
  return row?.c ?? 0;
}

export type { NodeRow, ObjectRow };
