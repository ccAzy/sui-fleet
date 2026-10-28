// 定时巡检：节点失联标记、到期/超量客户端禁用、旧用量清理。
import type { D1Database } from '@cloudflare/workers-types'
import { all, batch, now, run } from './db'
import { listObjects } from './objects'
import { refreshKernelInfo } from './kernel'

const STALE_SECONDS = 180

export async function cronTick(db: D1Database): Promise<void> {
  const ts = now()

  // 上游内核版本（内部有 6 小时节流，避免打爆 GitHub 匿名限额）
  await refreshKernelInfo(db)

  // 1) 超过 3 个上报周期没消息的节点标成 offline（不删，保留配置）
  await run(
    db,
    "UPDATE nodes SET core_state = 'offline' WHERE enabled = 1 AND core_state <> 'offline' AND last_seen > 0 AND last_seen < ?",
    ts - STALE_SECONDS,
  )

  // 2) 客户端到期 / 超量 / 自动重置
  const nodes = await all<{ id: string }>(db, 'SELECT id FROM nodes WHERE enabled = 1')
  for (const n of nodes) {
    const clients = await listObjects(db, n.id, 'clients')
    const stmts = []
    for (const c of clients) {
      const expiry = Number(c.expiry) || 0
      const volume = Number(c.volume) || 0
      const used = (Number(c.up) || 0) + (Number(c.down) || 0)
      let next = c
      let dirty = false

      if (expiry > 0 && expiry < ts && c.enable !== false) {
        next = { ...next, enable: false }
        dirty = true
      }
      if (volume > 0 && used >= volume && c.enable !== false) {
        next = { ...next, enable: false }
        dirty = true
      }
      // 周期重置：nextReset 到期把 up/down 归零并顺延
      const nextReset = Number(c.nextReset) || 0
      const resetDays = Number(c.resetDays) || 0
      if (resetDays > 0 && nextReset > 0 && nextReset <= ts) {
        next = { ...next, up: 0, down: 0, nextReset: ts + resetDays * 86400, enable: true }
        dirty = true
      }
      if (dirty) {
        stmts.push(
          db
            .prepare('UPDATE objects SET data = ?, updated_at = ? WHERE node_id = ? AND kind = ? AND obj_id = ?')
            .bind(JSON.stringify(next, null, 2), ts, n.id, 'clients', Number(c.id)),
        )
      }
    }
    if (stmts.length) await batch(db, stmts)
  }

  // 3) 用量明细只留 30 天
  await run(db, 'DELETE FROM usage WHERE ts < ?', ts - 30 * 86400)
  // 4) 变更日志只留 14 天
  await run(db, 'DELETE FROM changes WHERE ts < ?', ts - 14 * 86400)
}
