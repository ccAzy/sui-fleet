// 自托管入口：把 panel/src 的 Hono 应用原样跑在 Node 上。
//
// 与 Cloudflare 版的对应关系：
//   Worker fetch      →  app.fetch(req, env)
//   Assets 绑定        →  createAssets(distDir)
//   scheduled(cron)    →  node-cron 调同一个 cronTick
//   环境变量/密钥      →  process.env
//
// 业务代码零改动：这里只提供"运行时外壳"。
import { serve } from '@hono/node-server'
import cron from 'node-cron'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import panel from '../../../panel/src/index.ts'
import { SqliteD1 } from './d1.ts'
import { createAssets } from './assets.ts'

const log = (line: string) => process.stdout.write(`${line}\n`)

const here = resolve(process.cwd())
const dbPath = process.env.SUI_DB ?? '.data/sui.db'
const port = Number(process.env.PORT ?? 8788)
const panelBase = process.env.PANEL_BASE ?? `http://127.0.0.1:${port}`
const distDir = process.env.SUI_DIST ?? resolve(here, '../../panel/frontend-dist')

if (!existsSync(dbPath)) {
  log(`找不到数据库：${dbPath}`)
  log('先导入快照：npm run import -- .data/prod.sql .data/sui.db')
  process.exit(1)
}
if (!existsSync(distDir)) {
  log(`找不到前端产物：${distDir}（先跑 panel/build-frontend.sh）`)
  process.exit(1)
}

const db = SqliteD1.open(dbPath)
const assets = createAssets(distDir)

const env = {
  DB: db,
  ASSETS: assets,
  JWT_SECRET: process.env.JWT_SECRET ?? 'selfhost-dev-secret-change-me',
  PANEL_BASE: panelBase,
  ADMIN_USER: process.env.ADMIN_USER,
  ADMIN_PASS: process.env.ADMIN_PASS,
}

log(`s-ui selfhost 启动：port=${port} db=${dbPath}`)
log(`  panel_base=${panelBase}`)
log(`  dist=${distDir}`)

serve(
  {
    port,
    fetch: (req: Request) => panel.fetch(req, env as never, {} as never),
  },
  () => log(`  监听 http://127.0.0.1:${port}`),
)

// 与 wrangler.toml 的 crons 保持一致（*/10）；cronTick 内部还有 6 小时清理节流
cron.schedule('*/10 * * * *', () => {
  panel
    .scheduled({} as never, env as never)
    .catch((err: unknown) => log(`cron 失败：${err instanceof Error ? err.message : String(err)}`))
})

const shutdown = () => {
  log('收到退出信号，关闭数据库')
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
