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

// 会话签名密钥必须显式配置：回退到一个仓库里写死的常量，等于把「伪造任意管理员会话」
// 的能力公开（源码人人可见）。缺了就拒绝启动，而不是悄悄用一个公开值。
const jwtSecret = process.env.JWT_SECRET ?? "";
if (!jwtSecret) {
  console.error(
    [
      "[sui-panel] 缺少 JWT_SECRET。请在 /etc/sui-panel.env 里设置一个随机值，例如：",
      "  JWT_SECRET=$(openssl rand -hex 32)",
      "没有它，任何人都能用源码里的默认密钥伪造管理员会话。",
    ].join("\n"),
  );
  process.exit(1);
}

const env = {
  DB: db,
  ASSETS: assets,
  JWT_SECRET: jwtSecret,
  PANEL_BASE: panelBase,
  ADMIN_USER: process.env.ADMIN_USER,
  ADMIN_PASS: process.env.ADMIN_PASS,
  // 执行器令牌：只有自托管部署才有，Worker 上没有
  OPS_EXEC_TOKEN: process.env.OPS_EXEC_TOKEN,
  // 手动触发 /__cron 的密钥（CF 定时走 scheduled 事件，不需要它）。
  // 不配就等同于关闭这个路由 —— fail closed。
  CRON_SECRET: process.env.CRON_SECRET,
  // 反代形态决定怎么取客户端 IP。原来这个变量压根没从进程环境转发进来，
  // 于是 clientIp() 永远走 "cf" 分支（没有 cf-ray → 全部落到 direct 一个桶），
  // 单测里测的 TRUST_PROXY=1 在部署中无效。自建 Caddy/Nginx 时必须设成 1
  // 且保证反代会**重写** X-Forwarded-For。
  TRUST_PROXY: process.env.TRUST_PROXY,
};

// ---- 防脑裂：启动前对一次代次（epoch） ----
// 被仲裁者降级的实例，本地 meta.control_epoch 一定落后于面板记录的代次；
// 这种情况必须以只读身份启动（这里直接拒绝启动），否则两台同时写就是脑裂。
// 只有显式 SUI_FORCE=1 才允许强行以主控身份启动（演练/灾难恢复用）。
async function assertEpochCurrent(): Promise<void> {
  const token = process.env.SUI_OPS_TOKEN;
  const localRow = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .bind("control_epoch");
  const local = Number(
    ((await localRow.first<{ value: string }>())?.value ?? "0") || 0,
  );

  let remote: number | undefined;
  if (token) {
    try {
      const res = await fetch(`${panelBase}/api/arbiter?token=${token}`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { obj?: { epoch?: number } };
      remote = Number(body.obj?.epoch ?? 0);
    } catch {
      remote = undefined; // 仲裁不可达：按本地继续，避免网络抖动把主控锁死
    }
  }

  const gate = epochGate({
    local,
    remote,
    force: process.env.SUI_FORCE === "1",
    hasToken: !!token,
  });
  if (gate.allow) {
    const why = {
      "no-token": "未配置 SUI_OPS_TOKEN，跳过",
      fresh: `本地 ${local} = 仲裁 ${remote}`,
      forced: `⚠ 代次落后（本地 ${local} < 仲裁 ${remote}）但 SUI_FORCE=1，强行启动`,
      "unknown-remote": "仲裁不可达，按本地继续",
    }[gate.reason];
    log(`  代次校验：${why}`);
    return;
  }
  log(`  拒绝启动：本地 epoch=${gate.local} 落后于仲裁记录的 ${gate.remote}`);
  log("  这是防脑裂保护——该实例已被降级为备机。");
  log("  要用它当主控：先确认原主控已停止，再设 SUI_FORCE=1 启动。");
  process.exit(3);
}

await assertEpochCurrent();

log(`s-ui selfhost 启动：port=${port} db=${dbPath}`);
log(`  panel_base=${panelBase}`);
log(`  dist=${distDir}`);

// 监听地址很关键：@hono/node-server 不传 hostname 就是 0.0.0.0:8788。
// 那是明文 HTTP，绕过 Caddy/Cloudflare 直接对外——实测 hk/jp 的 8788 从公网
// 能拿到 200，等于给了一条不走 TLS 的登录入口。面板只该被本机 Caddy 反代。
// 需要局域网访问，显式设 SUI_PANEL_HOST（例如 192.168.8.103）。
const hostname = process.env.SUI_PANEL_HOST ?? "127.0.0.1";

serve(
  {
    port,
    hostname,
    fetch: (req: Request) => panel.fetch(req, env as never, {} as never),
  },
  () => log(`  监听 http://${hostname}:${port}`),
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
