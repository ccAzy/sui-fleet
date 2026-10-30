// 定时巡检：节点失联标记、到期/超量客户端禁用、旧用量清理。
import type { D1Database } from "@cloudflare/workers-types";
import { all, batch, now, run } from "./db";
import { listObjects } from "./objects";
import { refreshKernelInfo } from "./kernel";

const STALE_SECONDS = 180;

export async function cronTick(db: D1Database): Promise<void> {
  const ts = now();

  // 上游内核版本（内部有 6 小时节流，避免打爆 GitHub 匿名限额）
  await refreshKernelInfo(db);

  // 1) 超过 3 个上报周期没消息的节点标成 offline（不删，保留配置）
  await run(
    db,
    "UPDATE nodes SET core_state = 'offline' WHERE enabled = 1 AND core_state <> 'offline' AND last_seen > 0 AND last_seen < ?",
    ts - STALE_SECONDS,
  );

  // 2) 客户端：延迟启动 → 周期重置 → 到期/超量停用
  //    顺序与上游 ClientService.ResetClients + DepleteClients 一致：
  //    先让"首次使用"开始计时、先做周期重置，再判断是否该停用。
  /**
   * 下一个自然月起点（按 +08:00 算）。
   * "每月"应该指自然月，而不是"设置那一刻起 30 天"——后者第一次清零会落在
   * 11/29 20:49 这种说不出所以然的时刻。
   */
  function nextMonthStart(ts: number): number {
    const d = new Date((ts + 8 * 3600) * 1000);
    // Date.UTC 自动处理跨年：m 传 12 会归一成次年 1 月
    const ms =
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 8 * 3600 * 1000;
    return Math.floor(ms / 1000);
  }

  /** 本轮周期结束时刻：resetMode=month 按月首，否则按 resetDays 滚动 */
  function periodEnd(
    cur: { resetMode?: unknown },
    ts: number,
    resetDays: number,
  ): number {
    return cur.resetMode === "month"
      ? nextMonthStart(ts)
      : ts + resetDays * 86400;
  }

  const nodes = await all<{ id: string }>(
    db,
    "SELECT id FROM nodes WHERE enabled = 1",
  );
  for (const n of nodes) {
    const clients = await listObjects(db, n.id, "clients");
    const stmts = [];
    for (const c of clients) {
      let cur = c;
      let dirty = false;

      const up = Number(cur.up) || 0;
      const down = Number(cur.down) || 0;
      const resetDays = Number(cur.resetDays) || 0;
      let nextReset = Number(cur.nextReset) || 0;
      let expiry = Number(cur.expiry) || 0;
      const volume = Number(cur.volume) || 0;
      const enable = cur.enable !== false;

      // 2a) 延迟启动：勾了这个开关时，计时从"第一次真正产生流量"开始
      if (cur.delayStart === true && up + down > 0) {
        if (cur.autoReset === true) {
          nextReset = periodEnd(cur, ts, resetDays);
        } else {
          expiry = ts + resetDays * 86400;
        }
        cur = { ...cur, delayStart: false };
        dirty = true;
      }

      // 2b) 周期重置：把本轮用量归零并顺延，同时恢复启用
      if (
        cur.autoReset === true &&
        resetDays > 0 &&
        nextReset > 0 &&
        nextReset <= ts
      ) {
        cur = {
          ...cur,
          totalUp: (Number(cur.totalUp) || 0) + up,
          totalDown: (Number(cur.totalDown) || 0) + down,
          up: 0,
          down: 0,
          nextReset: periodEnd(cur, ts, resetDays),
          enable: true,
        };
        dirty = true;
      }

      // 2c) 停用：累计用量超额，或到期。两者任一满足即停（与上游 > 严格比较一致）
      const used = (Number(cur.up) || 0) + (Number(cur.down) || 0);
      if (enable) {
        if (volume > 0 && used > volume) {
          cur = { ...cur, enable: false };
          dirty = true;
        } else if (expiry > 0 && expiry < ts) {
          cur = { ...cur, enable: false };
          dirty = true;
        }
      }

      if (dirty) {
        stmts.push(
          db
            .prepare(
              "UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?",
            )
            .bind(
              JSON.stringify(cur, null, 2),
              ts,
              n.id,
              "clients",
              Number(cur.id),
            ),
        );
      }
    }
    if (stmts.length) {
      await batch(db, stmts);
      // 关键：cron 改了 client（重置归零 / 超额停用 / 延迟启动）必须推进 revision，
      // 否则节点永远收不到这次变化——月度重置后节点还按旧的 up/down 判断，
      // 结果是"面板已经清零，节点侧仍然把用户停着"。
      await run(
        db,
        "UPDATE nodes SET revision = revision + 1, updated_at = ? WHERE id = ?",
        ts,
        n.id,
      );
    }
  }

  // 3) 用量明细只留 30 天
  await run(db, "DELETE FROM usage WHERE ts < ?", ts - 30 * 86400);
  // 4) 变更日志只留 14 天
  await run(db, "DELETE FROM changes WHERE ts < ?", ts - 14 * 86400);
}
