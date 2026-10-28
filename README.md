# s-ui Cloud

把 **s-ui 的管理面板**放到 Cloudflare，代理节点仍然跑在你自己的服务器上。

[![License: GPL v3](https://img.shields.io/badge/license-GPL%20V3-blue.svg)](./LICENSE)

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

- **面板**：多节点管理、入站/出站/客户端/TLS/DNS/规则全功能、7 套皮肤、明暗主题
- **下发**：节点每 30 秒拉一次配置，未变更返回 304 级响应，带宽开销可忽略
- **上报**：流量增量、在线数、CPU/内存/磁盘、内核状态
- **订阅**：`base64` 链接列表 / `Clash YAML` / `sing-box JSON` 三种格式
- **配额**：流量上限、到期时间、延迟启动、周期重置（语义与 s-ui 一致）
- **运维**：内核版本可见、节点二进制一键升级（sha256 校验 + 原子替换）、批量重启/更新
- **安全**：PBKDF2 密码、HttpOnly JWT、登录限流、首次强制改密、可选 Cloudflare Access

## 快速开始

### 1. 部署控制面

需要：Node.js 18+、Cloudflare 账号、（推荐）一个自己的域名。

```bash
# 构建前端（产物在 frontend-dist/）
cd panel && npm install && npm run build:web

# 建库，把返回的 database_id 填进 panel/wrangler.toml
npx wrangler login
npx wrangler d1 create sui-panel

# 建表 + 部署
npx wrangler d1 execute DB --remote --file=./schema.sql
npx wrangler deploy

# 设管理员密码（必须在 deploy 之后，secret 要求 Worker 已存在）
npx wrangler secret put ADMIN_PASS
npx wrangler secret put JWT_SECRET
```

`panel/wrangler.toml` 里要改两处：`database_id`、`PANEL_BASE`（你的面板域名）。

### 2. 接入节点

先在面板「Servers → Add Server」建节点，**token 只显示一次**，复制下来。然后在服务器上：

```bash
scp dist/sui-agent-linux-amd64 scripts/install-agent.sh root@你的服务器:/root/

ssh root@你的服务器
cd /root && bash install-agent.sh \
  --panel https://panel.你的域名 \
  --token 刚才复制的token
```

脚本会建独立数据目录 `/opt/sui-agent`、写 systemd 服务、开机自启。

> 服务器上**不需要** Node.js / npm / Docker / 单独装 sing-box——agent 是静态编译的 Go 二进制，
> sing-box 已链接在里面。唯一要求是能出站访问面板域名。

## 目录结构

```text
panel/            Cloudflare Worker（Hono + D1 + 静态前端托管）
  src/            路由、对象语义、agent 协议、订阅、备份、定时任务
  schema.sql      D1 表结构
  wrangler.toml   ★ 部署前改 database_id 和 PANEL_BASE
  test/e2e.py     32 项端到端自检

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
| `JWT_SECRET` | Secret | 否 | 不设会生成一次并存在 D1 `meta` 表 |
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

自检：`python panel/test/e2e.py http://127.0.0.1:8787`

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
