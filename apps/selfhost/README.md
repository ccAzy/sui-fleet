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

## 备份与恢复（P3）

三份东西分工不同：

| 对象 | 命令 | 说明 |
| --- | --- | --- |
| 全量快照（主控 → 待机） | `scripts/snapshot-pull.sh` | 待机机每小时拉一次 `/api/getdb?token=<备份令牌>`，重建 `standby.db` |
| 从快照恢复 | `scripts/restore.sh <db>` | 停服务 → 归档当前库 → 恢复 → 起服务 → 健康检查失败自动回滚 |
| 迁移一致性校验 | `npm run verify -- a.db b.db` | 表集合 + 逐表行数 + 内容哈希 |

**备份里不含什么**（恢复后要人工重配）：

- `meta`：`jwt_secret`（不搬走 → 旧会话自然失效）、备份令牌、内核版本缓存
- `login_attempts`：临时安全状态
- `usage` / `changes` 会有少量差异（运行时持续写入，属正常）

**备份令牌怎么配**（在主控上执行一次）：

```bash
TOK=$(openssl rand -hex 24)
HASH=$(printf '%s' "$TOK" | sha256sum | cut -d' ' -f1)
npx wrangler d1 execute DB --remote --config wrangler.local.toml \
  --command "INSERT INTO meta(key,value) VALUES('backup_token_hash','$HASH')
             ON CONFLICT(key) DO UPDATE SET value=excluded.value"
echo "把 $TOK 写进待机机的 /etc/sui-snapshot.env：BACKUP_TOKEN=$TOK"
```

令牌只能访问 `/api/getdb` 一个端点，每次使用会在 `changes` 里留一条 `actor=backup-token` 的审计。
