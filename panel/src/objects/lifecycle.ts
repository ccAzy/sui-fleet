// 节点生命周期：删除（清数据 + 审计）、建节点种子。跨表操作，改错一次就是数据丢失。
import type { D1Database } from "@cloudflare/workers-types";
import { batch, now } from "../db";
import { DEFAULT_CONFIG } from "./consts";

export async function deleteNode(
  db: D1Database,
  nodeId: string,
  actor: string,
): Promise<void> {
  const ts = now();
  await batch(db, [
    db.prepare("DELETE FROM objects WHERE node_id = ?").bind(nodeId),
    db.prepare("DELETE FROM settings WHERE node_id = ?").bind(nodeId),
    db.prepare("DELETE FROM changes WHERE node_id = ?").bind(nodeId),
    db.prepare("DELETE FROM usage WHERE node_id = ?").bind(nodeId),
    db.prepare("DELETE FROM commands WHERE node_id = ?").bind(nodeId),
    db.prepare("DELETE FROM nodes WHERE id = ?").bind(nodeId),
    // 审计行放在最后：batch 顺序执行，前面那条 DELETE FROM changes 已经把该节点的
    // 历史清掉，这一行必须活下来，否则「谁在什么时候删了哪台」永远查不到。
    db
      .prepare(
        "INSERT INTO changes (node_id, ts, actor, kind, action, obj) VALUES (?, ?, ?, 'node', 'delete', ?)",
      )
      .bind(nodeId, ts, actor || "system", JSON.stringify({ id: nodeId })),
  ]);
}

/** 建节点时复制一份默认配置，避免新节点面板空白。 */

export async function seedNode(db: D1Database, nodeId: string): Promise<void> {
  const ts = now();
  await batch(db, [
    db
      .prepare(
        "INSERT INTO settings (node_id, key, value) VALUES (?, 'config', ?) ON CONFLICT(node_id, key) DO UPDATE SET value = excluded.value",
      )
      .bind(nodeId, JSON.stringify(DEFAULT_CONFIG, null, 2)),
    // route.final 指向 direct，节点上必须有这个出站，否则内核起不来
    // （对应 s-ui 初始化时自动写入的默认出站）。
    db
      .prepare(
        "INSERT INTO objects (node_id, kind, obj_id, tag, data, updated_at) VALUES (?, ?, 1, ?, ?, ?) " +
          "ON CONFLICT(node_id, kind, obj_id) DO NOTHING",
      )
      .bind(
        nodeId,
        "outbounds",
        "direct",
        JSON.stringify({ id: 1, type: "direct", tag: "direct" }, null, 2),
        ts,
      ),
  ]);
}
