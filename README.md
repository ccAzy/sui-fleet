# s-ui Cloud

把 **s-ui 的管理面板**放到 Cloudflare，代理节点仍然跑在你自己的服务器上。

[![License: GPL v3](https://img.shields.io/badge/license-GPL%20V3-blue.svg)](./LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USER/sui-cf/tree/main/panel)

> 上面的按钮：点一下就用你自己的 Cloudflare 账号跑起来。Cloudflare 会 fork 仓库到你的 GitHub、**自动创建 D1 数据库**、构建并部署，最后提示你填 `ADMIN_PASS`。
> （把 `YOUR_GITHUB_USER` 换成实际仓库地址后才能点。）
>
> 仅用于个人学习与交流，请遵守你所在地区的法律法规。上游版权归原作者所有。

---

## 这个项目解决什么问题

原版 s-ui 是一个二进制 = 面板 + 订阅 + **内嵌 sing-box 内核** + SQLite，跑在某台 VPS 上。

一旦你有五六台机器，就会遇到：主控那台被墙了 / 服务商跑路了 / 到期忘了续 → **所有节点都失去管理入口**。

本项目把「管理面」和「转发面」拆开：

```text
浏览器 ──> Cloudflare Worker + D1（面板 / 配置库 / 订阅）
                  ▲
                  │ HTTPS 出站：节点主动拉配置、上报状态
      ┌───────────┼───────────┐
    节点 A       节点 B       节点 C
  sui-agent    sui-agent    sui-agent
  (sing-box)   (sing-box)   (sing-box)
```

两个关键设计：

1. **控制面不依赖任何一台 VPS**。面板在 Cloudflare 上，节点跑路/换机房/被封都不影响你登录管理。
2. **方向是节点拉，不是面板推**。面板不需要能连到节点，节点只需要能出站访问面板域名。

渲染 sing-box 配置的逻辑**没有重写**：面板只下发对象快照，节点侧复用 s-ui 原生的
`GetAllConfig / addUsers / StartCore`，所以协议支持、链接生成、用户挂载规则与上游一致。

## 特性

- **面板**：多节点管理、入站/出站/客户端/TLS/DNS/规则全功能、明暗主题 + 自定义壁纸
- **下发**：节点按间隔（默认 30 秒，面板生成的安装脚本用 60 秒）拉配置；未变更时只回一个 `{ok:true,unchanged:true}` 小包，带宽开销可忽略
- **上报**：流量增量、在线数、CPU/内存/磁盘、内核状态
- **订阅**：`base64` 链接列表 / `Clash YAML` / `sing-box JSON` 三种格式
- **配额**：流量上限、到期时间、延迟启动、周期重置（语义与 s-ui 一致）
- **运维**：内核版本可见、节点二进制一键升级（sha256 校验 + 原子替换）、批量重启/更新
- **安全**：PBKDF2 密码、HttpOnly JWT、登录限流、首次强制改密、可选 Cloudflare Access

## 快速开始

### 1. 部署控制面

需要：Node.js 18+（仅本地构建/部署用）、Cloudflare 账号、（推荐）一个自己的域名。
> 自托管运行时（`apps/selfhost`）要求 **Node ≥ 22.5**，因为它用了 `node:sqlite`。

#### 方式 A：一键（点按钮）

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USER/sui-cf/tree/main/panel)
```

Cloudflare 会读仓库里的 `panel/wrangler.toml`，自动创建 D1 并把真实 `database_id` 回填到你克隆出的仓库，然后部署。前端产物（`panel/frontend-dist`）已随仓库提交，所以**部署时不需要构建**。

#### 方式 B：一条命令（本地跑）

```bash
cd panel
bash deploy.sh --domain panel.example.com   # 不填域名则只能用 *.workers.dev
```

脚本会依次完成：装依赖 → 构建前端 → 登录 → 建 D1（幂等，不会重复建）→ 填真实 `database_id` → 建表 → 部署 → 设 `ADMIN_PASS` / `JWT_SECRET`。

#### 方式 C：手动

```bash
cd panel
npm install && npm run build:web        # 产物写到 panel/frontend-dist
cp wrangler.toml wrangler.local.toml    # 真实配置用 local，不入库
npx wrangler login
npx wrangler d1 create sui-panel        # 把返回的 database_id 填进 wrangler.local.toml
npm run deploy:local                    # 建表 + 部署（都会用 local 配置）

npx wrangler --config wrangler.local.toml secret put ADMIN_PASS
npx wrangler --config wrangler.local.toml secret put JWT_SECRET
```

#### 两份配置的区别（重要）

| 文件 | 是否入库 | 用途 |
| --- | --- | --- |
| `wrangler.toml` | ✅ 入库 | 占位版，给 Deploy 按钮读。`database_id` 是全零占位，Cloudflare 部署时自动回填 |
| `wrangler.local.toml` | ❌ gitignore | 你本地的真实配置：真实 `database_id`、面板域名、自定义域名路由 |

**不要直接改 `wrangler.toml` 里的 `database_id`** —— 那是共享的占位文件。改 `wrangler.local.toml`，并用 `--config wrangler.local.toml`（或 `npm run deploy:local`）。

### 2. 接入节点

节点二进制 **不在仓库里**（73 MB，编译进去的 sing-box 占大头）。先选一种拿到它：

| 方式 | 命令 | 适用 |
| --- | --- | --- |
| 自行编译 | `cd node && bash build.sh`（需 Go 1.26.5 + gcc，CGO 要开） | 有 Go 环境 |
| 面板分发 | 把二进制分片放到 `panel/frontend-dist/dl/`（见 `apps/selfhost/scripts/publish-agent.sh`） | 已有面板 |
| 直接拷 | 从已有部署的 `/opt/sui-agent/bin/sui-agent` 复制 | 迁移 |

拿到二进制后，在面板「Servers → Add Server」建节点。保存后弹窗会**直接给出一次性 token
和一条完整的安装命令**（在弹窗里点复制即可；关掉后 token 再也找不回来，但可以点节点的
「轮换令牌」重新生成一条，不必删节点）。

也可以手工执行：

```bash
# 把二进制和安装脚本传上去（文件名保持一致，脚本默认找 ./sui-agent）
scp sui-agent scripts/install-agent.sh root@你的服务器:/root/

ssh root@你的服务器
cd /root && bash install-agent.sh \
  --panel https://panel.你的域名 \
  --token 刚才复制的token \
  --bin ./sui-agent
```

脚本会建独立数据目录 `/opt/sui-agent`、写 systemd 服务、开机自启。

> 服务器上**不需要** Node.js / npm / Docker / 单独装 sing-box——agent 是静态编译的 Go 二进制，
> sing-box 已链接在里面。唯一要求是能出站访问面板域名。

#### 怎么确认它真的通了

三层，缺一层都会“看着在线但用不了”：

```bash
# 1) 进程在跑
systemctl is-active sui-agent            # → active
# 2) 内核起来了（这一步最容易被忽略）
systemctl status sui-agent | grep -i 'sing-box started'
ss -tlnp | grep -E '443|8443|其他入站端口'
# 3) 面板侧能看到它在蹦
#    面板 → Servers：状态点变绿、kernel_ver 有值、applied_rev == revision
```

经验：**「在线」只代表 agent 能上报，不代表数据面可用**。面板要看 `core_state` + 端口监听，不能只看 `last_seen`。

## 目录结构

```text
panel/            Cloudflare Worker（Hono + D1 + 静态前端托管）
  src/            路由、对象语义、agent 协议、订阅、备份、定时任务
  schema.sql      D1 表结构（幂等，可重复执行）
  frontend-dist/  前端构建产物（★ 已提交，一键部署时无需构建）
  wrangler.toml   ★ 占位配置（入库，供 Deploy 按钮读取）
  wrangler.local.toml  你的真实配置（gitignore）
  .dev.vars.example    本地 secret 模板（ADMIN_PASS / JWT_SECRET）
  test/e2e.py     端到端自检（53 处断言；实测 52 通过，1 处是全新库才走的分支）

apps/
  arbiter/        仲裁者 Worker（探活、切 DNS、代次防脑裂）
  selfhost/       自托管运行时（Node + node:sqlite，复用 panel/src 业务代码）
    src/d1.ts       D1 兼容层（在 node:sqlite 上实现 prepare/bind/batch）
    scripts/        promote（新机接管）/ deploy-code（日常改码）/ snapshot-pull / restore
  ops/            可选：本机执行器，供面板一键调 promote.sh（默认不启用）

frontend/         前端（Vue 3 + Vuetify），派生自 s-ui-frontend
node/             节点程序（S-UI 分支，含 agent 子命令；sing-box 编译在内）
scripts/
  install-agent.sh  节点安装
  build-wsl.sh      交叉编译节点二进制（WSL）
  test-update.sh    自更新链路验证
docs/preview/     截图
```

## 配置项

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `DB` | D1 binding | 是 | 数据 |
| `ADMIN_PASS` | Secret | **建议** | 首次建号密码；不设则 `admin/admin` 并强制改密 |
| `ADMIN_USER` | Secret | 否 | 默认 `admin` |
| `JWT_SECRET` | Secret | **自托管必填** | Worker 下不设会生成一次并存进 D1 `meta`；**自托管缺它直接拒绝启动** |
| `CRON_SECRET` | Secret | 否 | 手动触发 `POST /__cron` 的口令。不配 = 该路由关闭（Cloudflare 定时走 `scheduled`，不需要它） |
| `PANEL_BASE` | Var | 否 | 订阅链接里用的地址 |

登录方式是**用户名 + 密码**，不是 UUID/Token。地址 `https://面板域名/login`。

## 本地开发

```bash
# 前端
cd frontend && npm install && npm run dev

# 面板（本地 D1 + 静态资源）
cd panel && npm install
npx wrangler d1 execute DB --local --file=./schema.sql
npx wrangler dev

# 节点（需要 Go 1.26.5 + gcc，CGO 用于 sqlite）
cd node
go build -tags "with_quic,with_grpc,with_utls,with_acme,with_gvisor,badlinkname,tfogo_checklinkname0,with_tailscale" \
  -ldflags '-w -s -checklinkname=0' -o sui-agent .
```

节点排障：`sui-agent agent --panel x --token y --dump-config` 会打印本地渲染出的 sing-box 配置。

自检：`python3 panel/test/e2e.py http://127.0.0.1:8787`（需空库 + 可登录实例，跑法见下）

### e2e 怎么跑（首次实例）

`panel/test/e2e.py` 需要**空库 + 可登录**的实例（任意运行时都行）：

```bash
# 1) 建空库
node -e 'const {DatabaseSync}=require("node:sqlite");const fs=require("fs");
          new DatabaseSync("/tmp/e2e.db").exec(fs.readFileSync("panel/schema.sql","utf8"))'

# 2) 起自托管实例（端口 8799，独立库）
cd apps/selfhost && SUI_DB=/tmp/e2e.db SUI_DIST=../../panel/frontend-dist \
  PORT=8799 JWT_SECRET=e2e CRON_SECRET=test-cron-secret npm start &

# 3) 跑
cd panel && CRON_SECRET=test-cron-secret python3 test/e2e.py http://127.0.0.1:8799
```

测试会自己完成“首次强制改密”这一步；**每次跑要用新库**（跑完密码已被改掉）。

## 自托管部署（apps/selfhost）

不想依赖 Cloudflare 时，控制面可以跑在任何 Linux 上：Node ≥ 22.5（用到 `node:sqlite`）+ 一个目录。

```bash
cd apps/selfhost && npm ci

# 首次：从一个已有面板拉一份完整备份并建库
curl -fsSL "https://已有面板/api/getdb?token=<运维令牌>" -o /tmp/bundle.json
npm run import-bundle -- /tmp/bundle.json ./data/sui.db

# 跑起来（JWT_SECRET 必填）
SUI_DB=./data/sui.db SUI_DIST=../../panel/frontend-dist \
  JWT_SECRET=$(openssl rand -hex 32) npm start
```

日常改代码用 `apps/selfhost/scripts/deploy-code.sh`（只换代码/前端产物，**不碰数据库**，失败自动回滚）；
新机器接管才用 `apps/selfhost/scripts/promote.sh`（会导入备份库，所以带了“本地库更新就跳过”的保护）。

TLS：`apps/selfhost/scripts/enable-tls.sh` 装一个单文件 Caddy 反代到 8788；Cloudflare 后面用 Origin Certificate（zone 是 strict 时自签会被拒）。

## 审计与修复记录

`docs/audit-fixes-2026-11-01.md` 记录了两轮独立只读审计指出问题的逐条修复：现象、根因、改法、
验证方式，以及**明确保留的取舍**（Worker 侧 PBKDF2 受 CPU 限制、`apps/ops` 属于可选高权限组件、
节点二进制不入库等）。改动范围对应提交 `0b39565..19d7021`。

## 与上游 s-ui 的差异

| 方面 | 上游 s-ui | 本项目 |
| --- | --- | --- |
| 面板位置 | 每台机器各一份 | 集中到 Cloudflare |
| 配置来源 | 本地 SQLite | D1，节点拉取快照 |
| 通信方向 | 面板 ↔ 节点（APIv2 反代） | 节点 → 面板（单向出站） |
| 内核位置 | 面板进程内 | 节点进程内（面板不含内核） |
| 实时性 | 秒级（读内核内存） | 分钟级（30 秒上报） |
| 面板协议 | `/api/{action}` + `object/action/data` | **保持一致**，前端可复用 |
| 内核升级 | 替换 s-ui 二进制 | 替换 agent 二进制（sha256 + 原子替换） |

不支持：`linkConvert` / `subConvert`（依赖节点侧内核能力），面板自更新（Worker 走 `wrangler deploy`）。

## 常见问题

**打开是 404 / 空白** — 没跑 `npm run build:web`，或 `frontend-dist` 不在 `panel` 同级。

**节点一直 Offline** — token 不对 / 服务器出站到面板不通 / `systemctl status sui-agent` 没起来。
先 `journalctl -u sui-agent -n 50`。

**开了 Cloudflare Access 后全部节点掉线** — Access 把 `/agent/*` 拦了。必须给 `/agent/*` 和 `/sub/*` 加 Bypass。

**内核起不来** — 用 `--dump-config` 看渲染结果；最常见是 443 被旧面板或 nginx 占用。

**升级报「未配置更新源」** — 面板不托管二进制（Workers 单文件 25MB 限制）。把新包放到任意 HTTPS 地址，
`POST /api/release` 登记 `{url, sha256, version}` 后即可一键下发。

## License

GPL-3.0，见 [LICENSE](./LICENSE)。

派生自 [alireza0/s-ui](https://github.com/alireza0/s-ui) 与 [Teminuosi/s-ui](https://github.com/Teminuosi/s-ui)，
前端派生自 [Teminuosi/s-ui-frontend](https://github.com/Teminuosi/s-ui-frontend)。
内核为 [SagerNet/sing-box](https://github.com/SagerNet/sing-box)。
