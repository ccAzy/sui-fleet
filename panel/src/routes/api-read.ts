import type { Hono } from "hono";
import {
  baseUrl,
  currentUser,
  json,
  okMsg,
  randHex,
  resolveNode,
} from "../http";
import {
  all,
  first,
  getNode,
  listNodes,
  now,
  run,
  type Env,
  type NodeRow,
} from "../db";
import {
  changedSince,
  getConfig,
  getSettings,
  listObjects,
  loadFull,
  loadPartial,
} from "../objects";
import { getKernelInfo, isOutdated, metaGet } from "../kernel";
import { generateKeypair } from "../keypairs";

// 状态接口高频轮询用的模块级缓存：内核版本 / agent 发布版本都在 meta 里，6 小时才变一次，
// 没必要每次请求都回表（每次 3 行 × 一天几万次 = 十几万 rows_read）。
let metaCache: {
  at: number;
  kernel: Awaited<ReturnType<typeof getKernelInfo>>;
  agentRelease: string;
} | null = null;

export function registerApiRead(app: Hono<{ Bindings: Env }>) {
  app.get("/api/load", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node)
      return json(c, {
        config: {},
        inbounds: [],
        outbounds: [],
        endpoints: [],
        services: [],
        clients: [],
        tls: [],
        onlines: {},
        subURI: "",
      });
    const lu = c.req.query("lu") ?? "";
    const changed = await changedSince(c.env.DB, node.id, lu);
    const subURI = `${baseUrl(c)}/sub/${node.id}?k=${node.sub_key}`;
    if (!changed) {
      return json(c, { onlines: onlinesOf(node) });
    }
    return json(c, await loadFull(c.env.DB, node.id, subURI));
  });

  // 按 id 批量取对象。上游 s-ui 的 Go 面板有这两个接口，移植到 Worker 时漏了；
  // 后果不是“少个功能”，而是静默数据错：
  //   - 客户端编辑弹窗拿到空对象 → 保存时 id=0 → 变成“新建一个随机名的新账号”；
  //   - 入站弹窗拿不到数据 → 打开就 TypeError。
  const parseIds = (raw: string): number[] =>
    raw
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

  const idsOfClient = (cl: Record<string, unknown>): number[] => {
    const list = Array.isArray(cl.inbounds) ? cl.inbounds : [];
    return list
      .map((x) =>
        typeof x === "number"
          ? x
          : Number((x as Record<string, unknown>)?.id ?? 0),
      )
      .filter((n) => n > 0);
  };

  app.get("/api/inbounds", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, { inbounds: [] });
    const ids = parseIds(c.req.query("id") ?? "");

    const [inbounds, clients] = await Promise.all([
      listObjects(c.env.DB, node.id, "inbounds"),
      listObjects(c.env.DB, node.id, "clients"),
    ]);
    const picked = ids.length
      ? inbounds.filter((ib) => ids.includes(Number(ib.id)))
      : inbounds;

    // users 回“客户端名字”：与上游 GetAll 语义一致，直接回对象会在列表里rendered 成 [object Object]
    const withUsers = picked.map((ib) => ({
      ...ib,
      users: clients
        .filter((cl) => idsOfClient(cl).includes(Number(ib.id)))
        .map((cl) => String(cl.name ?? "")),
    }));
    return json(c, { inbounds: withUsers });
  });

  app.get("/api/clients", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, { clients: [] });
    const ids = parseIds(c.req.query("id") ?? "");
    const rows = await listObjects(c.env.DB, node.id, "clients");
    const picked = ids.length
      ? rows.filter((cl) => ids.includes(Number(cl.id)))
      : rows;
    return json(c, { clients: picked });
  });

  // 一键添加（QuickTemplate）依赖：生成 Reality 密钥对 / 自签证书
  app.get("/api/keypairs", async (c) => {
    const kind = c.req.query("k") ?? "";
    const options = c.req.query("o") ?? "";
    return json(c, await generateKeypair(kind, options));
  });

  app.get("/api/servers", async (c) => {
    const nodes = await listNodes(c.env.DB);
    return json(c, {
      servers: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        url: n.address,
        token: "",
        remark: n.remark,
        enabled: n.enabled,
        last_seen: n.last_seen,
        core_state: n.core_state,
        kernel_ver: n.kernel_ver,
        agent_ver: n.agent_ver,
        revision: n.revision,
        applied_rev: n.applied_rev,
      })),
    });
  });

  app.get("/api/settings", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, {});
    return json(c, await getSettings(c.env.DB, node.id));
  });

  app.get("/api/config", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, {});
    return json(c, { config: await getConfig(c.env.DB, node.id) });
  });

  for (const kind of [
    "inbounds",
    "outbounds",
    "endpoints",
    "services",
    "tls",
    "clients",
  ] as const) {
    app.get(`/api/${kind}`, async (c) => {
      const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
      if (!node) return json(c, { [kind]: [] });
      const data = await loadPartial(c.env.DB, node.id, [kind]);
      return json(c, data);
    });
  }

  app.get("/api/status", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, {});
    // 内核/版本这两个值都在 meta 表里、6 小时才变一次，但状态接口是高频轮询的，
    // 每次去读 3 行纯属浪费额度 —— 模块级缓存 60 秒（Worker 实例内共享）。
    const nowTs = Math.floor(Date.now() / 1000);
    if (!metaCache || nowTs - metaCache.at > 60) {
      metaCache = {
        at: nowTs,
        kernel: await getKernelInfo(c.env.DB),
        agentRelease: (await metaGet(c.env.DB, "agent_release_version")) ?? "",
      };
    }
    const kernel = metaCache.kernel;
    // 没配更新源时这里是空串；下面必须区分「空」和「版本不同」
    const agentReleaseVersion = metaCache.agentRelease;
    let status: Record<string, unknown> = {};
    try {
      status = JSON.parse(node.status_json) as Record<string, unknown>;
    } catch {
      status = {};
    }
    // 原样透传节点上报的状态对象（cpu / mem / dsk / net / sys / sbd …），
    // 前端的 Gauge / History 组件按 s-ui 的结构读，压平成数字会全部显示 "-/-"。
    // UsageStats 弹窗（api/status?r=db）要的是"库里各类对象数量 + 客户端累计流量"
    let dbInfo: Record<string, number> | undefined;
    if ((c.req.query("r") ?? "").split(",").includes("db")) {
      const counts = await all<{ kind: string; c: number }>(
        c.env.DB,
        "SELECT kind, COUNT(*) as c FROM objects WHERE node_id = ? GROUP BY kind",
        node.id,
      );
      const traffic = await first<{ up: number; down: number }>(
        c.env.DB,
        "SELECT COALESCE(SUM(CAST(json_extract(data,'$.up') AS INTEGER)),0) AS up, " +
          "COALESCE(SUM(CAST(json_extract(data,'$.down') AS INTEGER)),0) AS down " +
          "FROM objects WHERE node_id = ? AND kind = 'clients'",
        node.id,
      );
      // 大备份导入中途失败会留下这个标记（backup.ts 写的），但它原来没有任何读者，
      // 用户永远不知道库是半成品。这里把它带出来，前端能显示、运维能 grep。
      const half = await first<{ value: string }>(
        c.env.DB,
        "SELECT value FROM meta WHERE key = 'import_in_progress'",
      );

      const info: Record<string, number> = {
        clients: 0,
        inbounds: 0,
        outbounds: 0,
        services: 0,
        endpoints: 0,
        clientUp: traffic?.up ?? 0,
        clientDown: traffic?.down ?? 0,
      };
      for (const row of counts) {
        if (row.kind in info) info[row.kind] = row.c;
      }
      if (half?.value) info.import_in_progress = Number(half.value) || 0;
      dbInfo = info;
    }

    const sbd = (status.sbd as Record<string, unknown>) ?? {};
    return json(c, {
      ...status,
      running: node.core_state === "running",
      // 内核运行态以面板记录的 core_state 为准（节点刚上报时 sbd 可能还没带全）
      sbd: {
        ...sbd,
        running: node.core_state === "running",
        stats: sbd.stats ?? {},
      },
      ...(dbInfo ? { db: dbInfo } : {}),
      kernel: {
        version: node.kernel_ver,
        latest: kernel.latest,
        outdated: isOutdated(node.kernel_ver, kernel.latest),
        checked_at: kernel.checkedAt,
      },
      // 节点上的包版本 vs 面板配置的分发包版本：不一致才是"可更新"。
      // 不能拿上游 sing-box tag 当更新依据——内核编译进 agent，换 tag ≠ 手上有新包。
      agent: {
        version: node.agent_ver,
        latest: agentReleaseVersion,
        // 必须要求 latest 非空：没配更新源时 release_version 是空串，
        // 只比「版本不相等」会把每台节点都判成可更新，界面上就永远挂着一个点了没用的按钮。
        outdated:
          Boolean(node.agent_ver) &&
          Boolean(agentReleaseVersion) &&
          node.agent_ver !== agentReleaseVersion,
      },
    });
  });

  app.get("/api/onlines", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    return json(
      c,
      node ? onlinesOf(node) : { inbound: [], outbound: [], user: [] },
    );
  });

  function onlinesOf(node: NodeRow) {
    try {
      const st = JSON.parse(node.status_json) as Record<string, unknown>;
      const on = (st.onlines ?? {}) as Record<string, unknown>;
      return {
        inbound: (on.inbound as string[]) ?? [],
        outbound: (on.outbound as string[]) ?? [],
        user: (on.user as string[]) ?? [],
        // 面板状态页顶部用它判断在线/离线
        last_seen: node.last_seen,
        core_state: node.core_state,
      };
    } catch {
      return { inbound: [], outbound: [], user: [] };
    }
  }

  app.get("/api/logs", async (c) => {
    // 前端传 c（class/级别）与 l（行数），原来两个参数都不读。
    const cls = (c.req.query("c") ?? "").trim();
    const lim = Math.min(
      Math.max(parseInt(c.req.query("l") ?? "50", 10) || 50, 1),
      500,
    );
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, []);
    let st: Record<string, unknown> = {};
    try {
      st = JSON.parse(node.status_json) as Record<string, unknown>;
    } catch {
      st = {};
    }
    // 新键 status.logs（数组）优先；老数据只有 last_log（单条）
    const raw = Array.isArray(st.logs)
      ? (st.logs as unknown[]).map(String)
      : typeof st.last_log === "string" && st.last_log
        ? [st.last_log]
        : [];
    const filtered = cls
      ? raw.filter((l) => l.toLowerCase().includes(cls.toLowerCase()))
      : raw;
    return json(c, filtered.slice(-lim));
  });

  app.get("/api/changes", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, []);
    const since = parseInt(c.req.query("k") ?? "0", 10) || 0;
    const actor = c.req.query("a") ?? "";
    const count = Math.min(parseInt(c.req.query("c") ?? "100", 10) || 100, 500);
    const rows = await all<{
      id: number;
      ts: number;
      actor: string;
      kind: string;
      action: string;
      obj: string;
    }>(
      c.env.DB,
      "SELECT id, ts, actor, kind, action, obj FROM changes WHERE node_id = ? AND ts >= ?" +
        (actor ? " AND actor = ?" : "") +
        " ORDER BY id DESC LIMIT ?",
      ...(actor ? [node.id, since, actor, count] : [node.id, since, count]),
    );
    // 前端 Changes.vue 读的是 dateTime / key / obj
    return json(
      c,
      rows.map((r) => ({
        id: r.id,
        dateTime: r.ts,
        actor: r.actor,
        key: r.kind,
        action: r.action,
        obj: r.obj,
      })),
    );
  });

  // 流量时序：Stats.vue 按 {dateTime(秒), direction, traffic} 逐条消费
  app.get("/api/stats", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, []);
    const tag = c.req.query("tag") ?? "";
    const limit = Math.min(parseInt(c.req.query("limit") ?? "1", 10) || 1, 168);
    const since = now() - limit * 3600;
    const rows = await all<{
      ts: number;
      tag: string;
      up: number;
      down: number;
    }>(
      c.env.DB,
      "SELECT ts, tag, up, down FROM usage WHERE node_id = ? AND ts > ?" +
        (tag ? " AND tag = ?" : "") +
        " ORDER BY ts ASC",
      ...(tag ? [node.id, since, tag] : [node.id, since]),
    );
    const out: Array<{
      dateTime: number;
      direction: boolean;
      traffic: number;
      tag?: string;
    }> = [];
    for (const r of rows) {
      if (r.up > 0)
        out.push({
          dateTime: r.ts,
          direction: true,
          traffic: r.up,
          tag: r.tag,
        });
      if (r.down > 0)
        out.push({
          dateTime: r.ts,
          direction: false,
          traffic: r.down,
          tag: r.tag,
        });
    }
    return json(c, out);
  });

  app.get("/api/updateInfo", async (c) =>
    json(c, { current: "cf-0.1.0", latest: "cf-0.1.0" }),
  );

  // 管理员列表（Admins 页依赖；lastLogin 必须是字符串，前端会 split）
  app.get("/api/users", async (c) => {
    const rows = await all<{ id: number; username: string }>(
      c.env.DB,
      "SELECT id, username FROM users ORDER BY id ASC",
    );
    return json(
      c,
      rows.map((r) => ({ id: r.id, username: r.username, lastLogin: "" })),
    );
  });

  // 第三方调用用的 API Token（面板自用，给脚本/监控取订阅或改配置）
  app.get("/api/tokens", async (c) => {
    const session = await currentUser(c);
    if (!session) return json(c, []);
    const rows = await all<{
      id: number;
      desc: string;
      token: string;
      expiry: number;
    }>(
      c.env.DB,
      "SELECT id, desc, token, expiry FROM tokens WHERE user_id = ? ORDER BY id DESC",
      session.uid,
    );
    return json(c, rows);
  });

  app.post("/api/addToken", async (c) => {
    const session = await currentUser(c);
    if (!session) return json(c, null, new Error("Invalid login"));
    const body = await c.req.parseBody();
    const desc = String(body.desc ?? "");
    const expiry = parseInt(String(body.expiry ?? "0"), 10) || 0;
    const token = randHex(24);
    await run(
      c.env.DB,
      "INSERT INTO tokens (user_id, desc, token, expiry, created_at) VALUES (?, ?, ?, ?, ?)",
      session.uid,
      desc,
      token,
      expiry,
      now(),
    );
    return json(c, token);
  });

  app.post("/api/deleteToken", async (c) => {
    const body = await c.req.parseBody();
    const id = parseInt(String(body.id ?? "0"), 10);
    if (!id) return json(c, null, new Error("invalid id"));
    await run(c.env.DB, "DELETE FROM tokens WHERE id = ?", id);
    return okMsg(c);
  });

  // 前端的"服务器列表"= 这里的受管节点。可达性用 agent 最近一次上报的时间判断，
  // 不需要（也不应该）由面板反连节点。
  app.get("/api/testServer", async (c) => {
    const id = c.req.query("id") ?? "";
    const node = await getNode(c.env.DB, id);
    if (!node) return json(c, { online: false, error: "node not found" });
    const age = now() - node.last_seen;
    const online = node.last_seen > 0 && age < 180;
    return json(c, {
      online,
      // 这里给的是「距上次上报多少秒」，不是网络延迟（面板从不反连节点）。
      // 字段名原来叫 latency，前端直接拼成 "N ms"，170 秒没上报会显示成 170 ms。
      age,
      latency: online ? Math.max(1, age) : 0, // 保留旧字段，避免老前端炸
      error: online
        ? ""
        : node.last_seen === 0
          ? "agent 尚未上报过"
          : `已 ${age}s 未上报`,
    });
  });

  /** servers 对象映射到 nodes 表（前端的服务器管理页直接可用来建/改/删节点）。 */
}
