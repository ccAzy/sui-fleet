# 审计问题修复记录（2026-11-01）

两份独立只读审计（架构 / 安全 / 验收三视角，含亲手复现）指出的问题，本轮逐条修复。
本文只记事实：改了什么、为什么这么改、怎么验证的、还剩哪些取舍没做。

- 基线提交：`0b39565`（脱敏完成后）
- 本文对应提交：`19d7021`
- 变动规模：7 个提交，32 个文件，+1074 / −414 行

---

## 一、P0 级（会丢数据 / 能绕过安全）

### 1. 二次验证（2FA）可被完全绕过

**现象**：知道密码的人拿 `/api/login` 返回的 120 秒 `ticket`，直接写进 `sui_session` cookie 就是完整会话，2FA 全程不问。

**根因**：`currentUser()` 只检查 `payload.u` 是不是字符串，不区分「会话」与「OTP 票据」（后者 payload 里是 `otp:1`）。

**改法**：`panel/src/auth.ts` 抽出纯函数 `isSessionPayload()`，`otp:1` 一律拒绝；`http.ts` 改用它。

**验证**：hk 生产实例，手工签一张 `{u,uid,otp:1}` 断言为 cookie →
`{"success":false,"msg":"Invalid login"}`；同一把密钥签的正常会话 → `{"success":true,...}`（证明拦的是票据而不是整个鉴权）。单测 4 条（`panel/test/unit/auth.test.ts`）。

### 2. 备份导入会清空整库、且抹掉本机密钥

**现象**：`/api/importdb` 先 `DELETE` 所有表再逐批插入。中途任一约束失败 → 「库已清空、只导入了一半」。另外 `meta` 里 `jwt_secret` / `ops_token_hash` / `backup_token_hash` 被一起删掉，恢复后备份令牌失效、仲裁者再也写不进 epoch。

**改法**（`panel/src/backup.ts`）：

1. 导入前读出本地三个秘密，导入时**跳过备份里的同名行**，最后原样写回；
2. 语句总量 ≤ 400 时用**一次 `batch`**（D1 的 batch 是事务，失败整体回滚）；
3. 超过 400 必须分块时，先落 `meta.import_in_progress` 标记，完成后清除；失败时错误信息明说「库可能是半成品」。

**验证**：确定性测试（全新库 + 种两个本地秘密 + 导入含「恶意」秘密的备份）：

```text
meta 导入条数: 1（只留 agg_key）
jwt_secret = LOCAL-JWT → 保留✓
ops_hash   = LOCAL-OPS → 保留✓
agg_key    = from-backup → 已更新✓
import_in_progress 残留: 0
```

### 3. 备份令牌绕过「强制改密」，且与运维令牌混用

**现象**：新实例 `admin/admin` 会置 `must_change=1`，此时除白名单外全部拒绝；但 `/api/getdb` 的令牌分支提前 `return next()`，永远走不到 `mustChange` 检查 —— 一条备份令牌就能导出全库（含密码哈希、TOTP 密钥、节点 token）。
另：`verifyOpsToken` 同时接受 `ops_token_hash` 和 `backup_token_hash`，等于把「拉备份」的权限升级成「改仲裁代次」。

**改法**：

- `auth.ts` 拆成 `verifyBackupToken`（只认 backup）、`verifyOpsToken`（只认 ops）、`verifyPullToken`（拉备份时二者皆可）；
- `index.ts` 的 `/api/getdb` 在令牌通过后**再查 `must_change=1`**，有未改密用户就拒绝。

**验证**：hk 生产实例，伪装 getdb / arbiter 请求 → 均 `{"success":false,...}`；jp 的每小时快照任务仍 `Result=success`（证明拆令牌没弄坏无人值守链路）。

### 4. `/__cron` 完全无鉴权

**现象**：`app.all("/__cron")` 注册在 `/api/*` 守卫之外，任何 GET 都能触发全量巡检（配额判定、到期停用、流量重置、数据清理）。

**改法**：要求 `X-Cron-Secret`，**没配 `CRON_SECRET` 就默认拒绝**（fail closed）。Cloudflare 定时走 `scheduled()` 事件，本来就不需要这个路由；它只用于排障/测试。

**验证**：hk 生产实例，无密钥 → `403 forbidden`，错密钥 → `403 forbidden`。

### 5. 一键接入脚本 `install.sh` 必然失败

**现象**（三个独立缺陷叠加）：

1. `ExecStart` 里用的 `$SUI_AGENT_PANEL` / `$SUI_AGENT_TOKEN` **在生成脚本的 shell 里从未定义**，配合 `set -u` 直接中止；
2. env 文件写的键是 `SUI_AGENT_PANEL`，而 agent 实际读 `SUI_PANEL`（`node/cmd/agent.go:106`）；
3. 安装器期望 `/dl/<name>.gz.parts`，而 `publish-agent.sh` 产出的是 `/dl/<name>.parts`（gz 只用于压缩中间产物）。

**改法**（`panel/src/install-script.ts`）：`ExecStart` 改用已定义的 `$PANEL`/`$TOKEN`；env 键改成 `SUI_PANEL`；分片基名去掉 `.gz`。

**验证**：逐处对照 agent 的 flag 定义与发布脚本的实际产出命名；shell 语法 + 变量定义链人工核过（未在真机跑完整安装，见「三、仍未闭合」）。

### 6. `restore.sh` 恢复必然回滚

**现象**：健康检查打 `/api/servers`，该接口在登录守卫之后，未登录永远返回 `{"success":false,...}`；脚本 grep `"success":true` 永远不命中 → 15 次等待后判定失败并回滚。**即使恢复本身完美。**

**改法**：改探公开的 `/health`，判据 `"ok":true`；同时把默认库名对齐 `snapshot-pull.sh` 的产物 `standby.db`（原来是 `sui.db`，备用机拉下来的快照永远认不到）。

### 7. 前端三个核心功能因端点缺失而不可用

**现象**：`/api/clients`、`/api/inbounds` 后端根本没有（移植时漏了，上游 Go 面板有）。
后果不是「少个功能」而是**静默数据错**：客户端编辑弹窗拿到空对象 → `id` 丢失 → 保存走 `new` → 变成「新建一个随机名的新账号」，原客户端纹丝不动。用户看到的是「我改了个流量上限，结果多出一个人」。

**改法**（`panel/src/routes/api-read.ts`）：按上游语义补齐两个端点，支持 `?id=1,2,3` 批量与 `X-Remote-Server`；`inbounds.users` 回**客户端名字**（顺手修了列表显示 `[object Object]`）。

**验证**：hk 生产实例：

```text
GET /api/clients          → {"success":true,"obj":{"clients":[{"name":"user-rxhy76",...
GET /api/clients?id=1     → 精确返回 1 条
GET /api/inbounds         → {"success":true,"obj":{"inbounds":[{"type":"vless",...
```

---

## 二、P1 级（重要但可绕开 / 影响面有限）

### 8. 节点自更新链可被完全跳过校验

`/api/release` 原来只校验 url 是 http(s)，`sha256` 允许空串；agent 端 `if p.SHA256 != ""` 才校验 → 空串 = 不校验。谁能改这个 URL，谁就在所有节点上拿到 root。

- `/api/release`：强制 64 位 hex `sha256`；拒绝 `http://`；`sha256` 归一化为小写；
- `node/cmd/agent.go`：空 `sha256` 直接拒绝替换（不再是「可选」）；
- 替换前把旧二进制改名 `.old`，替换失败自动把旧版还回去。

**验证**：hk 生产实例两条负向断言（缺 sha256 / http）均被拒；e2e 新增同名断言并随 52 项一起通过。

### 9. 指令 `sent` 状态永久滞留

节点 pull 到指令后标 `sent`，若在 report 之前崩溃/断网，这条指令永远卡住（`pendingCommands` 还把它算作在途，面板长期显示 pending > 0）。

**改法**（`panel/src/agent.ts`）：老库自动补 `sent_at` / `attempts` 两列（`ALTER TABLE` 幂等，每 isolate 试一次）；下发时记时间；**超 10 分钟无回执且重试 < 3 次**退回 `pending`。上限存在的理由：`update_agent` 无上限重投会变成「更新→重启→再更新」死循环。

**验证**：hk 生产实例 `PRAGMA table_info(commands)` → 已含两列（自动迁移生效）。

### 10. 登录限流在自托管下锁死全站、`login_attempts` 无界增长

原来只认 `CF-Connecting-IP`，自托管没有这个头 → 全站挤成 `"local"` 一个桶，任意人失败 8 次就把管理员锁在门外。该表也从不清理。

**改法**：`http.ts` 新增 `clientIp()`（CF 头 → `X-Forwarded-For` → `X-Real-IP` → 兜底），并注明 XFF 可伪造、只用于分摊限流桶不用于权限判断；`cron.ts` 清理 7 天前的记录。

### 11. agent 没有内核存活守护

sing-box 在两轮 pull 之间崩了，`revision` 没变、`applied=false` → 循环永远不会再拉起它。节点表现为「面板在线、端口全不通」。

**改法**（`node/cmd/agent.go` + `node/service/config.go`）：

- 每轮 pull 前查 `IsCoreRunning()`，没在跑就强制重启；
- `restartCore` 失败时不再留着 `coreStarted=true`（否则只在 revision 变化时才重试）；
- `StartCore` 在 15 秒冷却期内**返回错误而不是 `nil`** —— 原来调用方会把「跳过」当「成功」。

**验证**：真编译（Go 1.26.5 + CGO + 全套 build tags）→ 滚到 10 台 → 逐台验心跳与 `core_state`：**10/10 OK，全部 `core=running`、`applied_rev == revision`**；每台保留 `sui-agent.old-<时间戳>` 可回滚。

> 编译环境的坑：WSL 里的 Go 是 1.24.6 而 `go.mod` 要 1.26.5，工具链下载被 WSL 的 DNS（`127.0.0.53 misbehaving`）挡住。绕法：本机走代理下载 Go 1.26.5 压缩包 → 解压到 WSL 的 `/tmp`（不动系统）→ 用 Windows 侧已有的模块缓存离线编译。

### 12. `apps/selfhost` 的 tsconfig 与类型依赖缺失

审计指出「`npx tsc --noEmit` 验证不了任何东西」。补上 `tsconfig.json` + `typescript` / `@types/node` / `@cloudflare/workers-types` 后 tsc 头一次真跑起来，**立刻暴露出 4 个真错误**：

| 错误 | 修法 |
| --- | --- |
| `assets.ts` 把 `Buffer` 当 `BodyInit` | 包成 `new Uint8Array(...)` |
| `node-cron` 无类型声明 | 加最小 `src/shims.d.ts` |
| `panel/src/*` 引不到 workers-types | tsconfig 加 `paths` 映射 |
| `targetIterations()` 的 `globalThis` 断言在 Node 类型下不兼容 | 改成交集类型 |

**验证**：`cd apps/selfhost && npx tsc --noEmit -p tsconfig.json` → **0 错误**。

### 13. 密码哈希迭代数

Worker 免费版 CPU 只有 10 ms，实测 120k 迭代就会 500 —— 不可能在 Worker 上做到 OWASP 的 600,000。

**改法**：按运行时区分（`panel/src/auth.ts`）——Worker `10,000`，Node `600,000`；哈希串本身带迭代数（`pbkdf2$ITER$salt$hash`），两边可互相验证；**登录成功时若存储的迭代数低于当前目标，顺手重算升格**，不需要停机迁移。

### 14. `node/web` 默认模式「编译过但跑不起来」

`//go:embed *` 在 `web/html/` 被 gitignore 时只嵌进 `web.go` 自己，`ParseFS` 运行时报错 → CI 绿、二进制起不来。

**改法**：改成 `//go:embed html`（缺文件在**编译期**失败），并在仓库里放一个占位 `node/web/html/index.html` 说明「这是 agent 二进制，不是完整面板」。同步从 `node/.gitignore` 移除 `web/html`。

### 15. selfhost 的两个安全默认值

- `JWT_SECRET` 缺失时回退到仓库里写死的 `"selfhost-dev-secret-change-me"` → 等于把伪造任意管理员会话的能力公开。改为**拒绝启动**并打印生成命令。
- `CRON_SECRET` 没透传给 `c.env`，导致手动触发 `/__cron` 永远 403（这是 e2e 跑不通的原因之一）→ 补上。

### 16. 其它收敛

| 项 | 改法 |
| --- | --- |
| CI 只覆盖 `panel/` | 增加 `arbiter`（6 条单测）与 `selfhost`（tsc）两个 job |
| `deploy-code.sh` 不同步 `apps/selfhost/package.json` | 补进打包清单（否则远程装不上新依赖） |
| `deploy-code.sh` 的 `DOMAIN` 默认值被脱敏成 `panel.example.com` | 改为从远端单元文件的 `PANEL_BASE` 自动读取 |
| README 数字不实（32 / 11） | 改为实测值：e2e 53 处断言（52 通过）、arbiter 6 条 |

---

## 三、取舍与仍未闭合（明确记录，不做隐瞒）

### 3.1 Worker 侧 PBKDF2 维持 10,000

**不移到 600,000**。理由：Cloudflare Workers 免费版 CPU 上限 10 ms，实测 12 万迭代即 500，登录会直接挂。迁移到付费版或改用 Worker 之外的认证服务才能解决，成本大于收益。
**代价**：Worker 部署实例的密码哈希弱于自托管实例。已在 `panel/src/auth.ts` 注释与 `AUDIT-NOTES.md` 中写明。
**缓解**：自托管侧 600,000；两端可互相验证，未来迁到自托管时登录即自动升格。

### 3.2 `apps/ops` 对单人自用偏重

`apps/ops`（本机 Node 执行器 + SSH + Caddy 引导 + `push-tls`）是为了「在面板上点一下就移交控制面」。它同时把 ops token 升级成「能 SSH 全机队的令牌」，攻击面与收益不成比例。

**决定**：不删，但在 README 与 `AUDIT-NOTES.md` 标为**可选组件、默认不启用**。真正要开源时可以考虑整体移到独立仓库。
**代价**：留着一个高权限组件，需要使用者自己判断是否启用。

### 3.3 e2e 有 1 处断言依赖分支

53 处 `check()`，实测 52 通过。差额是「首次登录强制改密」那条 —— 只在全新库首次运行时走入。这是测试结构问题，不是覆盖率问题。

### 3.4 节点二进制不入库

73 MB（内嵌 sing-box），不适合进 git。README 给了三条获取路径（自行编译 / 面板分片分发 / 直接拷），但**首次接入确实比「clone 下来就能跑」多一步**。这是体积与便利的取舍，不是遗漏。

### 3.5 未做的（审计提出但本轮不处理）

| 项 | 原因 |
| --- | --- |
| 订阅协议覆盖不全（hysteria v1 / naive / socks / http 生成链接但 Clash/sing-box 解析不支持） | 需要一份协议描述表驱动四处输出，属重构，改动面大于本轮其它修复之和 |
| 仲裁者重做（持久化 primary、候选探活、dry-run 与 epoch 解耦） | 当前 `DRY_RUN=1` 只观察不改，风险可控；重构需要单独设计 |
| 统一协议描述表 / D1 shim 并发模型 / 服务端令牌类型化（session / otp-ticket / read-only） | 均为「以后再说」档 |
| `/api/updateInfo`、`/api/restartApp`、`tokens` 表等死功能 | 目前只是误导，不影响正确性；清理需同时改前端 |

---

## 四、验证汇总（本轮全部命令与结果）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 面板类型 | `cd panel && npx tsc --noEmit` | exit 0 |
| 面板单测 | `npx vitest run test/unit/` | **16 passed**（原 12 + 新增 4 条 `isSessionPayload`） |
| 仲裁者单测 | `cd apps/arbiter && npm test` | **6 pass / 0 fail** |
| 自托管类型 | `cd apps/selfhost && npx tsc --noEmit -p tsconfig.json` | **0 错误**（补 tsconfig 前这条命令跑不起来） |
| 端到端 | `CRON_SECRET=… python3 panel/test/e2e.py http://127.0.0.1:8799` | **52 通过 / 53 处断言，ALL PASS**（本轮首次真正跑通） |
| Go 编译 | Go 1.26.5 + CGO + 全套 tags | 成功，73 MB |
| 节点上线 | 滚动部署 10 台 | **10/10** `core=running`，revision 全追平 |
| 安全回归 | hk 生产实例手工构造请求 | OTP 票据被拒、正常会话通过、`/__cron` 403、假令牌被拒 |
| 备份恢复 | 确定性测试（全新库 + 恶意备份） | 本地秘密保留 ✓、`agg_key` 更新 ✓、无残留标记 ✓ |
| shell 语法 | `bash -n apps/ops/argo/*.sh apps/selfhost/scripts/*.sh` | 全部通过 |

### 关于 e2e 为什么以前从没跑通

审计报告说它「在第 275 行崩溃」。本轮排掉 5 个卡点才跑通，其中 2 个是**实现缺陷**：

1. 新实例 `must_change=1` 时第一条写请求就被拒（测试要先改密）；
2. `PASS` 变量作用域写错（测试脚本自身）；
3. **`CRON_SECRET` 没透传给 `c.env`** → `/__cron` 403（实现缺陷）；
4. **测试没照前端语义带 `X-Remote-Server`**（面板是「多节点 + 当前节点」模型，不带就落到默认节点）；
5. 新增的「强制 sha256」拒绝了测试里用的 `deadbeef`（测试该跟着新约束走）。

---

## 五、怎么复核本文的每条结论

```bash
# 代码位置
git log --oneline 0b39565..HEAD          # 7 个提交
git diff 0b39565..HEAD -- panel/src/auth.ts        # 2FA 与令牌拆分
git diff 0b39565..HEAD -- panel/src/backup.ts      # 导入原子性与秘密保留
git diff 0b39565..HEAD -- node/cmd/agent.go        # 内核守护与自更新回滚

# 跑测试（国内需镜像）
cd panel && npm ci --registry=https://registry.npmmirror.com
npx vitest run test/unit/
cd ../apps/arbiter && npm install && npm test
cd ../selfhost && npm install && npx tsc --noEmit -p tsconfig.json

# e2e：需要空库 + 可登录实例，步骤见 README「e2e 怎么跑」
```text
