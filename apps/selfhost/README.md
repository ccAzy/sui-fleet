# sui-selfhost —— 把控制面搬到任意 Linux

把 `panel/src` 的 Hono 应用原样跑在 Node 上：同一份业务代码，两个运行时。

## 与 Cloudflare 版的对应关系

| Cloudflare | 自托管 |
| --- | --- |
| D1 绑定 | `SqliteD1`（`node:sqlite` 上的 D1 兼容层，见 `src/d1.ts`） |
| Assets 绑定 | `createAssets(distDir)`（含 SPA 兜底与同样的安全头） |
| `scheduled` | `node-cron` 调同一个 `cronTick` |
| 环境变量/密钥 | `process.env` |

## 用法

```bash
npm install
npm run import -- .data/prod.sql .data/sui.db   # 导入 wrangler d1 export 的快照
PORT=8788 PANEL_BASE=http://127.0.0.1:8788 \
JWT_SECRET=$(openssl rand -hex 32) npm start
```

环境变量：`SUI_DB`（默认 `.data/sui.db`）、`PORT`（8788）、
`PANEL_BASE`、`JWT_SECRET`、`SUI_DIST`（默认 `../../panel/frontend-dist`）、`ADMIN_USER` / `ADMIN_PASS`。

## 已验证（P1）

- 三种订阅格式（base64 / clash / sing-box）与线上**逐字节一致**
- `/agent/pull` 返回完整负载（5 inbound / 1 outbound / 1 client / 5 tls）
- `/agent/report` 写入生效：nodes 行更新、usage 新增、client 累计增加
- 首页 200 且安全头齐全（CSP / XFO / nosniff / noindex）

## 注意

- `node:sqlite` 需要 Node ≥ 22.5（本仓库按 Node 24 验证）
- 这是**影子实例**：默认只读验证用；接管生产前必须先看 `docs/plan-panel-portability.html` 的切换流程
