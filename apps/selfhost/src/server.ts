// 自托管入口：把 panel/src 的 Hono 应用原样跑在 Node 上。
//
// 与 Cloudflare 版的对应关系：
//   Worker fetch      →  app.fetch(req, env)
//   Assets 绑定        →  createAssets(distDir)
//   scheduled(cron)    →  node-cron 调同一个 cronTick
//   环境变量/密钥      →  process.env
//
// 业务代码零改动：这里只提供"运行时外壳"。
import { serve } from "@hono/node-server";
import cron from "node-cron";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import panel from "../../../panel/src/index.ts";
import { SqliteD1 } from "./d1.ts";
import { createAssets } from "./assets.ts";
import { epochGate } from "./epoch.ts";

const log = (line: string) => process.stdout.write(`${line}\n`);

const here = resolve(process.cwd());
const dbPath = process.env.SUI_DB ?? ".data/sui.db";
const port = Number(process.env.PORT ?? 8788);
const panelBase = process.env.PANEL_BASE ?? `http://127.0.0.1:${port}`;
const distDir =
  process.env.SUI_DIST ?? resolve(here, "../../panel/frontend-dist");

if (!existsSync(dbPath)) {
  log(`找不到数据库：${dbPath}`);
  log("先导入快照：npm run import -- .data/prod.sql .data/sui.db");
  process.exit(1);
}
if (!existsSync(distDir)) {
  log(`找不到前端产物：${distDir}（先跑 panel/build-frontend.sh）`);
  process.exit(1);
}

const db = SqliteD1.open(dbPath);
const assets = createAssets(distDir);

const env = {
  DB: db,
  ASSETS: assets,
  JWT_SECRET: process.env.JWT_SECRET ?? "selfhost-dev-secret-change-me",
  PANEL_BASE: panelBase,
  ADMIN_USER: process.env.ADMIN_USER,
  ADMIN_PASS: process.env.ADMIN_PASS,
};

// ---- 防脑裂：启动前对一次代次（epoch） ----
// 被仲裁者降级的实例，本地 meta.control_epoch 一定落后于面板记录的代次；
// 这种情况必须以只读身份启动（这里直接拒绝启动），否则两台同时写就是脑裂。
// 只有显式 SUI_FORCE=1 才允许强行以主控身份启动（演练/灾难恢复用）。
async function assertEpochCurrent(): Promise<void> {
  const token = process.env.SUI_OPS_TOKEN
  const localRow = db.prepare('SELECT value FROM meta WHERE key = ?').bind('control_epoch')
  const local = Number(((await localRow.first<{ value: string }>())?.value ?? '0') || 0)

  let remote: number | undefined
  if (token) {
    try {
      const res = await fetch(`${panelBase}/api/arbiter?token=${token}`, {
        signal: AbortSignal.timeout(5000),
      })
      const body = (await res.json()) as { obj?: { epoch?: number } }
      remote = Number(body.obj?.epoch ?? 0)
    } catch {
      remote = undefined // 仲裁不可达：按本地继续，避免网络抖动把主控锁死
    }
  }

  const gate = epochGate({ local, remote, force: process.env.SUI_FORCE === '1', hasToken: !!token })
  if (gate.allow) {
    const why = {
      'no-token': '未配置 SUI_OPS_TOKEN，跳过',
      fresh: `本地 ${local} = 仲裁 ${remote}`,
      forced: `⚠ 代次落后（本地 ${local} < 仲裁 ${remote}）但 SUI_FORCE=1，强行启动`,
      'unknown-remote': '仲裁不可达，按本地继续',
    }[gate.reason]
    log(`  代次校验：${why}`)
    return
  }
  log(`  拒绝启动：本地 epoch=${gate.local} 落后于仲裁记录的 ${gate.remote}`)
  log('  这是防脑裂保护——该实例已被降级为备机。')
  log('  要用它当主控：先确认原主控已停止，再设 SUI_FORCE=1 启动。')
  process.exit(3)
}

await assertEpochCurrent();

log(`s-ui selfhost 启动：port=${port} db=${dbPath}`);
log(`  panel_base=${panelBase}`);
log(`  dist=${distDir}`);

serve(
  {
    port,
    fetch: (req: Request) => panel.fetch(req, env as never, {} as never),
  },
  () => log(`  监听 http://127.0.0.1:${port}`),
);

// 与 wrangler.toml 的 crons 保持一致（*/10）；cronTick 内部还有 6 小时清理节流
cron.schedule("*/10 * * * *", () => {
  panel
    .scheduled({} as never, env as never)
    .catch((err: unknown) =>
      log(`cron 失败：${err instanceof Error ? err.message : String(err)}`),
    );
});

const shutdown = () => {
  log("收到退出信号，关闭数据库");
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
