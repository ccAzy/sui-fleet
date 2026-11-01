import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { COOKIE, login as doLogin, sha256, signJWT } from "../auth";
import {
  baseUrl,
  invalidateDefaultNode,
  json,
  okMsg,
  randHex,
  resolveNode,
  secretOf,
} from "../http";
import { getNode, listNodes, now, run, type Env } from "../db";
import {
  getConfig,
  loadPartial,
  purgeNodeData,
  saveObject,
  seedNode,
} from "../objects";
import { enqueueCommand } from "../agent";
import { metaGet, metaSet } from "../kernel";
import { exportBundle, importBundle, type Bundle } from "../backup";

export function registerApiWrite(app: Hono<{ Bindings: Env }>) {
  async function saveServers(
    c: any,
    action: string,
    data: unknown,
  ): Promise<unknown> {
    const d = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const idOf = (v: unknown) =>
      typeof v === "object" && v !== null
        ? String((v as Record<string, unknown>).id ?? "")
        : String(v ?? "");

    if (action === "del") {
      const id = idOf(d);
      if (id) {
        await purgeNodeData(c.env.DB, id);
        await run(c.env.DB, "DELETE FROM nodes WHERE id = ?", id);
      }
    } else if (action === "new" || action === "edit") {
      const name = str(d.name).trim();
      if (!name) throw new Error("name required");
      const address = str(d.url) || str(d.address);
      const remark = str(d.remark);
      const existingId = str(d.id);
      if (action === "edit" && existingId) {
        await run(
          c.env.DB,
          "UPDATE nodes SET name = ?, address = ?, remark = ?, updated_at = ? WHERE id = ?",
          name,
          address,
          remark,
          now(),
          existingId,
        );
      } else {
        const id = Math.random().toString(36).slice(2, 8);
        const raw = crypto.getRandomValues(new Uint8Array(24));
        const token = [...raw]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const subKey = randHex(16);
        const ts = now();
        await run(
          c.env.DB,
          "INSERT INTO nodes (id, name, token_hash, address, sub_key, remark, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
          id,
          name,
          await sha256(token),
          address,
          subKey,
          remark,
          ts,
          ts,
        );
        await seedNode(c.env.DB, id);

        // 明文 token 只在这里返回一次：节点侧只存 sha256，错过这次就找不回来。
        // 同时把 install_cmd 一起给前端，否则用户拿不到「粘一条命令就接入」的那条命令。
        const nodesAfter = await listNodes(c.env.DB);
        // 用请求的 origin 拼（Caddy/Cloudflare 会透传 Host），与 /api/nodes 里的写法一致
        const installBase = baseUrl(c);
        const installCmd =
          `curl -fsSL ${installBase}/install.sh -o /tmp/sui.sh && ` +
          `sudo bash /tmp/sui.sh --token ${token}`;
        return {
          // 返回**完整**列表：原来只回新节点，前端 setNewData 直接覆盖，
          // 于是加第二台时用户会以为第一台被删了（要等 5 分钟才重新拉全量）。
          servers: nodesAfter.map((n) => ({
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
          created: { id, name, token, install_cmd: installCmd },
        };
      }
    } else {
      throw new Error(`unknown action: ${action}`);
    }

    const nodes = await listNodes(c.env.DB);
    return {
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
    };
  }

  app.post("/api/save", async (c) => {
    const body = await c.req.parseBody();
    const obj = String(body.object ?? "");
    const action = String(body.action ?? "");
    let data: unknown = {};
    try {
      data = JSON.parse(String(body.data ?? "{}"));
    } catch {
      return json(c, null, new Error("invalid data json"));
    }

    if (obj === "servers") {
      try {
        return json(c, await saveServers(c, action, data));
      } catch (e) {
        return json(c, null, e);
      }
    }

    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, null, new Error("no node selected"));
    const actor = (c.get("user" as never) as string) ?? "";
    try {
      const res = await saveObject(
        c.env.DB,
        node.id,
        obj,
        action,
        data,
        String(body.initUsers ?? ""),
        actor,
        node.address || new URL(c.req.url).hostname,
      );
      const partial = await loadPartial(c.env.DB, node.id, res.objs);
      return json(c, partial, undefined);
    } catch (e) {
      return json(c, null, e);
    }
  });

  app.post("/api/restartSb", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, null, new Error("no node selected"));
    await enqueueCommand(
      c.env.DB,
      node.id,
      "restart_core",
      {},
      (c.get("user" as never) as string) ?? "",
    );
    return okMsg(c, "save");
  });

  // 面板自身不支持自更新（Cloudflare Worker 上无法自替换；自托管由 deploy-code.sh 负责）。
  // 但前端保留了上游的更新按钮，点到就会 POST 这个不存在的路径 →
  // 落到 SPA 兜底返回 HTML → 前端报 `unknown data: <!doctype html>`。
  // 显式给一条可读的拒绝，比让人看到 HTML 好。
  app.post("/api/updatePanel", async (c) =>
    json(
      c,
      null,
      new Error(
        "本部署不支持面板自更新：Cloudflare 上用 wrangler deploy，自托管用 deploy-code.sh",
      ),
    ),
  );

  // 重启面板：Worker 没有进程可重启；自托管由 systemd 负责。
  // 保留端点是为了让前端的按钮不至于 404，但必须说清楚它什么都没做。
  app.post("/api/restartApp", async (c) =>
    json(
      c,
      null,
      new Error(
        "本部署没有可重启的进程：自托管请执行 systemctl restart sui-panel",
      ),
    ),
  );

  app.post("/api/changePass", async (c) => {
    const body = await c.req.parseBody();
    const username = (c.get("user" as never) as string) ?? "";
    const oldPass = String(body.oldPass ?? "");
    const newPass = String(body.newPass ?? "");
    const newName = String(body.newUsername ?? "") || username;
    const user = await doLogin(c.env.DB, username, oldPass);
    if (!user) return json(c, null, new Error("Invalid login"));
    const { hashPassword } = await import("../auth");
    await run(
      c.env.DB,
      "UPDATE users SET username = ?, password_hash = ?, must_change = 0 WHERE id = ?",
      newName,
      await hashPassword(newPass),
      user.id,
    );
    // 重签 cookie，让 mc 立刻变 false，不用重新登录
    let https = true;
    try {
      https = new URL(c.req.url).protocol === "https:";
    } catch {
      https = true;
    }
    const fresh = await signJWT(
      { u: newName, uid: user.id, mc: false },
      await secretOf(c.env),
    );
    setCookie(c, COOKIE, fresh, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 86400,
      secure: https,
    });
    return okMsg(c, "save");
  });

  /* ---------- 备份 / 恢复（JSON 快照，D1 没有可下载的库文件） ---------- */

  app.get("/api/getdb", async (c) => {
    const exclude = (c.req.query("exclude") ?? "").split(",").filter(Boolean);
    const bundle = await exportBundle(c.env.DB, exclude);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return c.body(JSON.stringify(bundle, null, 2), 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sui-backup-${stamp}.json"`,
    });
  });

  app.post("/api/importdb", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    // 整库覆盖是不可逆操作：先卡住体积，避免一个超大文件把请求打到超时/内存爆掉，
    // 也避免把 D1/KV 的底层异常原文回给浏览器。
    const MAX_BYTES = 64 * 1024 * 1024;
    let text: string;
    try {
      if (ct.includes("multipart/form-data")) {
        const form = await c.req.formData();
        const file = form.get("db");
        if (!file || typeof file === "string")
          return json(c, null, new Error("没有收到文件"));
        if ((file as File).size > MAX_BYTES)
          return json(
            c,
            null,
            new Error("备份文件超过 64MB，请先在源面板排除统计再导出"),
          );
        text = await (file as File).text();
      } else {
        text = await c.req.text();
        if (text.length > MAX_BYTES)
          return json(c, null, new Error("备份文件超过 64MB"));
      }
    } catch {
      return json(c, null, new Error("读取上传内容失败"));
    }

    let data: Bundle;
    try {
      data = JSON.parse(text) as Bundle;
    } catch {
      // 不要把 JSON.parse 的原文（含位置偏移/片段）回给浏览器
      return json(
        c,
        null,
        new Error(
          "备份文件不是合法的 JSON（本接口只接受面板导出的 JSON，不接受 SQLite 文件）",
        ),
      );
    }

    try {
      return json(c, await importBundle(c.env.DB, data));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 业务错误（备份格式/版本）原样回；数据库层异常只回摘要，细节留在服务端日志
      const safe = /备份|备份版本|不是数组/.test(msg)
        ? msg
        : "导入失败，数据库已回滚或标记为半成品（详见服务端日志）";
      console.error("[importdb]", msg);
      return json(c, null, new Error(safe));
    }
  });

  /** 只导出当前的 sing-box 基础配置（log/dns/route/experimental）。
   *  完整配置在节点上渲染，节点侧用 `sui-agent --dump-config` 取。 */
  app.get("/api/singbox-config", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, null, new Error("no node selected"));
    const cfg = await getConfig(c.env.DB, node.id);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return c.body(JSON.stringify(cfg, null, 2), 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="config-${stamp}.json"`,
    });
  });

  // 第三方链接转换：这些需要节点侧内核能力，先明确回错而不是静默成功
  // 出站连通性测试：原版由节点侧内核执行（从节点视角测该出站能否连通）。
  // 面板跑在 Cloudflare，测出来的不是节点视角，因此明确回错而不是假装成功。
  app.get("/api/checkOutbound", async (c) => {
    const tag = c.req.query("tag") ?? "";
    return json(
      c,
      null,
      new Error(`checkOutbound(${tag}) 需要节点侧内核能力，暂未开放`),
    );
  });

  app.post("/api/linkConvert", async (c) =>
    json(c, null, new Error("linkConvert 需要节点侧能力，暂未开放")),
  );
  app.post("/api/subConvert", async (c) =>
    json(c, null, new Error("subConvert 需要节点侧能力，暂未开放")),
  );

  // ---------- 节点管理（servers 语义） ----------

  app.post("/api/nodes", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim();
    if (!name) return json(c, null, new Error("name required"));
    const id = Math.random().toString(36).slice(2, 8);
    const raw = crypto.getRandomValues(new Uint8Array(24));
    const token = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    const ts = now();
    await run(
      c.env.DB,
      "INSERT INTO nodes (id, name, token_hash, address, sub_key, remark, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
      id,
      name,
      await sha256(token),
      String(body.address ?? ""),
      randHex(16),
      String(body.remark ?? ""),
      ts,
      ts,
    );
    await seedNode(c.env.DB, id);
    // 一键接入：把"装哪些东西、写哪个单元、用什么 token"全部编进一条命令
    // 新建的第一台节点必须立刻成为「默认节点」：resolveNode 有 60 秒模块级缓存，
    // 不主动失效的话，界面上会出现「加了节点 60 秒内还是提示没有节点」。
    invalidateDefaultNode();
    const base = baseUrl(c);
    const install_cmd = `curl -fsSL ${base}/install.sh -o /tmp/sui.sh && sudo bash /tmp/sui.sh --token ${token}`;
    return json(c, { id, token, install_cmd });
  });

  // 启用/禁用节点：不删节点就能把它从「默认节点」「聚合订阅」里摘出去。
  // 之前 nodes.enabled 只有读取方、没有写入口，这个字段等于死状态。
  app.post("/api/nodes/:id/enabled", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.parseBody();
    const raw = String(body.on ?? "0");
    const on = raw === "1" || raw === "true";
    const node = await getNode(c.env.DB, id);
    if (!node) return json(c, null, new Error("node not found"));
    await run(
      c.env.DB,
      "UPDATE nodes SET enabled = ?, updated_at = ? WHERE id = ?",
      on ? 1 : 0,
      now(),
      id,
    );
    // 「第一个启用节点」的缓存必须立刻失效，否则禁用后 60 秒内还会被当成默认节点
    invalidateDefaultNode();
    // 禁用会改变聚合订阅的内容，也记一条 changes 让前端刷新
    await run(
      c.env.DB,
      "INSERT INTO changes (node_id, ts, actor, kind, action, obj) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      now(),
      (c.get("user" as never) as string) ?? "",
      "nodes",
      on ? "enable" : "disable",
      JSON.stringify({ name: node.name }),
    );
    return json(c, { id, enabled: on ? 1 : 0 });
  });

  // 轮换节点令牌：令牌丢了/疑似泄露时不必删节点（删节点会连带清掉它的客户端与订阅关系）。
  app.post("/api/nodes/:id/rotate-token", async (c) => {
    const id = c.req.param("id");
    const node = await getNode(c.env.DB, id);
    if (!node) return json(c, null, new Error("node not found"));
    const raw = crypto.getRandomValues(new Uint8Array(24));
    const token = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    await run(
      c.env.DB,
      "UPDATE nodes SET token_hash = ?, updated_at = ? WHERE id = ?",
      await sha256(token),
      now(),
      id,
    );
    const base = baseUrl(c);
    const installCmd =
      `curl -fsSL ${base}/install.sh -o /tmp/sui.sh && ` +
      `sudo bash /tmp/sui.sh --token ${token}`;
    return json(c, { id, token, install_cmd: installCmd });
  });

  app.post("/api/nodes/:id/delete", async (c) => {
    const id = c.req.param("id");
    await purgeNodeData(c.env.DB, id);
    await run(c.env.DB, "DELETE FROM nodes WHERE id = ?", id);
    // 删掉的正好是「默认节点」时，缓存里还留着它 —— 60 秒内 GET /api/load 会继续
    // 返回已删节点的数据，期间任何写操作都会落到不存在的 node_id 上；
    // 而 schema 没有外键 + purgeNodeData 已经跑过 ⇒ 产生永远不会被清理的孤儿行。
    invalidateDefaultNode();
    return okMsg(c);
  });

  /* ---------- 节点二进制（含内核）更新 ----------
     面板只存"更新源"（URL + sha256 + 版本），点更新时把这三项随指令下发；
     节点自己下载、校验、原子替换、重启。面板不托管二进制（Workers 单文件 25MB 限制，装不下 73MB）。 */

  async function getRelease(db: Env["DB"]) {
    return {
      url: await metaGet(db, "agent_release_url"),
      sha256: await metaGet(db, "agent_release_sha256"),
      version: await metaGet(db, "agent_release_version"),
    };
  }

  app.get("/api/release", async (c) => json(c, await getRelease(c.env.DB)));

  app.post("/api/release", async (c) => {
    const body = await c.req.parseBody();
    const url = String(body.url ?? "").trim();
    const sha = String(body.sha256 ?? "")
      .trim()
      .toLowerCase();
    if (url && !/^https?:\/\//.test(url))
      return json(c, null, new Error("url 必须是 http(s) 地址"));
    // 自更新链是权限最高的一条：谁能改这个 URL，谁就能在所有节点上以 root 执行任意二进制。
    // 所以 sha256 必须是强制的信任锚，不能靠“填了才校验”。
    if (url && !/^[0-9a-f]{64}$/.test(sha))
      return json(
        c,
        null,
        new Error("设置了更新地址就必须同时给 64 位 hex 的 sha256"),
      );
    if (url && url.startsWith("http://"))
      return json(
        c,
        null,
        new Error("更新地址必须是 https（http 等于把二进制交给中间人）"),
      );
    await metaSet(c.env.DB, "agent_release_url", url);
    await metaSet(c.env.DB, "agent_release_sha256", sha);
    await metaSet(
      c.env.DB,
      "agent_release_version",
      String(body.version ?? "").trim(),
    );
    return json(c, await getRelease(c.env.DB));
  });

  /* 批量：一次对全部启用节点下发（7 台机器逐台点太累） */
  app.post("/api/nodes/all/command", async (c) => {
    const body = await c.req.parseBody();
    const kind = String(body.kind ?? "restart_core");
    const nodes = await listNodes(c.env.DB);
    const actor = (c.get("user" as never) as string) ?? "";
    let queued = 0;
    for (const n of nodes) {
      if (!n.enabled) continue;
      await enqueueCommand(c.env.DB, n.id, kind, {}, actor);
      queued++;
    }
    return json(c, { queued });
  });

  app.post("/api/nodes/all/update-agent", async (c) => {
    const rel = await getRelease(c.env.DB);
    if (!rel.url)
      return json(
        c,
        null,
        new Error("尚未配置更新源：先填写 agent 分发包 URL 与 sha256"),
      );
    const nodes = await listNodes(c.env.DB);
    const actor = (c.get("user" as never) as string) ?? "";
    let queued = 0;
    for (const n of nodes) {
      if (!n.enabled) continue;
      await enqueueCommand(c.env.DB, n.id, "update_agent", rel, actor);
      queued++;
    }
    return json(c, { queued });
  });

  app.post("/api/nodes/:id/update-agent", async (c) => {
    const id = c.req.param("id");
    const node = await getNode(c.env.DB, id);
    if (!node) return json(c, null, new Error("node not found"));
    const rel = await getRelease(c.env.DB);
    if (!rel.url) {
      return json(
        c,
        null,
        new Error(
          "尚未配置更新源：先在面板设置里填写 agent 分发包 URL 与 sha256",
        ),
      );
    }
    await enqueueCommand(
      c.env.DB,
      id,
      "update_agent",
      rel,
      (c.get("user" as never) as string) ?? "",
    );
    return okMsg(c);
  });

  // 与 /api/status 一致：不传 id 时作用于当前选中节点（前端 currentServer 为空也能用）
  app.post("/api/updateAgent", async (c) => {
    const node = await resolveNode(c.env.DB, c.req.header("X-Remote-Server"));
    if (!node) return json(c, null, new Error("no node selected"));
    const rel = await getRelease(c.env.DB);
    if (!rel.url) {
      return json(
        c,
        null,
        new Error("尚未配置更新源：先填写 agent 分发包 URL 与 sha256"),
      );
    }
    await enqueueCommand(
      c.env.DB,
      node.id,
      "update_agent",
      rel,
      (c.get("user" as never) as string) ?? "",
    );
    return okMsg(c);
  });

  app.post("/api/nodes/:id/command", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.parseBody();
    const kind = String(body.kind ?? "restart_core");
    await enqueueCommand(
      c.env.DB,
      id,
      kind,
      {},
      (c.get("user" as never) as string) ?? "",
    );
    return okMsg(c);
  });

  // ---------- agent 接口 ----------
}
