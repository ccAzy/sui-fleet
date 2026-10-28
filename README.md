# s-ui Cloud 控制面

把 s-ui 的**管理面**搬到 Cloudflare，让控制台不依赖任何一台 VPS 存活；
真实代理转发仍跑在各节点本机。

```text
浏览器 ──> Cloudflare (Worker + D1 + 静态前端)
                  ▲
                  │  HTTPS，节点主动出站（pull 配置 / 上报状态）
      ┌───────────┼───────────┐
   节点 A       节点 B       节点 C
 sing-box      sing-box     sing-box
```

## 为什么这么拆

s-ui 原本是一个二进制 = 面板 + 订阅 + **内嵌 sing-box 内核** + SQLite。
Cloudflare 能承载前三项，承载不了内核（无常驻进程、不能监听任意端口跑 VLESS/Hysteria2）。
所以拆成两半：

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 面板 UI / API / 订阅 | Cloudflare Worker | 登录、增删改、配置库、订阅出口 |
| 配置库 | D1 (SQLite) | 每节点一套对象：inbounds/clients/tls/... |
| 定时期检 | Worker Cron | 失联标记、到期/超量禁用、数据清理 |
| 执行器 | 每台节点 | 拉配置 → 写本地 SQLite → 调 s-ui 原生逻辑起内核 → 上报 |

关键设计：**渲染 sing-box 配置的逻辑没有重写**。面板只下发"对象快照"，
节点侧复用 s-ui 现成的 `GetAllConfig / addUsers / StartCore`，所以协议支持、
链接生成、用户挂载规则与上游完全一致。

另一个关键点：**方向是节点拉，不是面板推**。面板不需要能连到节点，
节点被墙、换 IP、换机房都不影响管理。

## 目录

```text
panel/            Cloudflare Worker（Hono + D1）
  schema.sql      D1 表结构
  src/index.ts    路由（s-ui 兼容 /api/*、/agent/*、/sub/*）
  src/objects.ts  对象语义（save/load/关联维护）
  src/agent.ts    pull / report / 指令队列
  src/links.ts    分享链接生成（移植自 util/genLink.go）
  src/cron.ts     定时巡检
  test/e2e.py     本地端到端验证
agent/            Go 侧改动（打在 s-ui 源码上）
  cmd/agent.go           agent 子命令
  service/agent_access.go 暴露内核句柄
  install-agent.sh       节点安装脚本
```

## 部署（Cloudflare 侧）

```bash
cd panel
npm install
npx wrangler login
npx wrangler d1 create sui-panel          # 把返回的 database_id 填进 wrangler.toml
npx wrangler d1 execute DB --remote --file=./schema.sql
npx wrangler deploy
```

首次访问 `/api/login` 会自动按 `ADMIN_USER` / `ADMIN_PASS` 建号（缺省 admin/admin，
务必在 wrangler.toml 的 `[vars]` 或 dashboard 里改）。

## 部署（节点侧）

节点需要一个 `agent` 模式的二进制。构建：

```bash
# 需要 Go >= 1.25 + gcc（s-ui 的 sqlite 驱动用 CGO）
cd s-ui            # 上游源码 + 本仓库 agent/cmd/agent.go 与 service/agent_access.go
go build -tags "with_quic,with_grpc,with_utls,with_acme,with_gvisor,with_naive_outbound,badlinkname,tfogo_checklinkname0,with_tailscale" \
  -ldflags '-w -s -checklinkname=0' -o sui-agent main.go
```

安装（root）：

```bash
./install-agent.sh --panel https://panel.example.com --token <节点 token> --bin ./sui-agent
```

token 在面板「服务器」页新增节点时生成，只显示一次。

## 数据流

| 方向 | 端点 | 内容 | 周期 |
| --- | --- | --- | --- |
| 下行 | `POST /agent/pull` | 配置快照 + 待执行指令；未变更返回 `unchanged` | 30s |
| 上行 | `POST /agent/report` | 流量增量、在线列表、CPU/内存/磁盘、内核状态、指令回执 | 30s |
| 面板 | `GET /api/load?lu=` | 变更检测后返回全量对象 | 前端轮询 |
| 订阅 | `GET /sub/<nodeId>` | base64 分享链接 | 客户端拉取 |

## 与上游 s-ui 的关系

- 面板协议（`/api/{action}` + `object/action/data` 表单）保持原样，前端零改动即可复用。
- 「服务器」语义从"另一台 s-ui 面板地址"变成"受管节点"，字段仍是 `id/name/url/token/remark`。
- 节点的 `token` 现在是 agent token（库里只存 sha256，明文只在创建时返回一次）。
- 实时性：流量/在线数从"内核内存实时读"变成"每 30 秒上报一次的准实时"。
- 不再需要节点的面板端口对外开放。

## 已知边界

- Cloudflare 免费版：Worker 10 万请求/天、D1 每天 10 万行写入。7 台 × 30 秒一轮 ≈ 2 万请求/天，余量充足。
- `*.workers.dev` 在国内不可用，控制台必须绑自定义域名。
- 节点侧 agent 与已有 s-ui 面板不能同时跑（抢内核端口），换机器时先停旧服务。
- 订阅输出目前是 base64 链接列表；clash/json 格式待接。
- 只产出了 linux/amd64 二进制；arm64 需要 `aarch64-linux-gnu-gcc` 交叉工具链。
- `linkConvert` / `subConvert`（粘贴第三方链接转换）依赖节点侧内核能力，当前明确返回不支持。
- 节点日志走 s-ui 的 syslog 后端，排查用 `journalctl -u sui-agent`（或 `--dump-config`）。

## 实现中踩到的几个坑（都已修）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 登录成功又弹回登录页 | 前端路由守卫读 `document.cookie` 里的 `s-ui`，而 JWT 是 HttpOnly | 额外种一个可读的 `s-ui=1` 标记，鉴权仍走 HttpOnly |
| 面板显示 Clients 0 | s-ui 读取时才把客户端挂进 `inbound.users` | 面板侧 `load` 时按 `client.inbounds` 现算 |
| 客户端链接点开是空 | `client.inbounds` 是 id 数组、`links` 是 `{remark,type,uri}` | 按 s-ui 的真实结构生成，不再用字符串数组 |
| 节点内核起不来 | `transport:{type:"tcp"}` 是 UI 概念，sing-box 不认 | 存盘前归一化成 `{}` |
| 内核报 `default outbound not found: direct` | 新建节点没有默认出站 | 建节点时种 `direct`，agent 侧再加一道兜底 |

## 外观：按 Apple HIG 重做的 Liquid Glass

默认皮肤是 `liquid`。这一版不是"多加模糊"，而是把噪音减掉：

| 维度 | 做法 |
| --- | --- |
| 颜色 | 近黑中性底（#0B0B0D）+ **单一**强调色（系统蓝 #0A84FF）；不再整屏铺四色渐变大底 |
| 材质 | 玻璃只出现在浮层（顶栏 / 卡片 / 弹窗 / 菜单）；卡片 = 半透明表面 + 1px 描边 + 顶沿镜面高光 + 极弱阴影 |
| 字体 | 苹果字体栈（SF / Segoe UI Variable / PingFang SC）+ 明确三级层级；表格数字等宽 |
| 排版 | 卡片字段改成 Apple 设置页式键值行（标签左、值右、26px 行高）；弹窗里的"卡片套卡片"拍平为分组标题 |
| 控件 | 主操作实心蓝、次操作纯文字、破坏性操作弱红；标签页改成分段控件；输入框聚焦出 2px 蓝色外环 |
| 动效 | 200ms `cubic-bezier(0.2,0,0,1)`，不做弹跳 |

踩过的两个坑：

1. Vuetify 的 `flat` 变体会把背景压成 `surface` 色，主按钮会变黑 —— 主操作改用 `elevated`。
2. `prefers-reduced-transparency` 不能用来关材质：Windows 关闭"透明效果"时 Chrome 会上报 reduce，
   一刀切会让整套玻璃变实心板。

预览图：`docs/preview/`（home / inbounds / clients / dialog / settings）。

### 布局层

- **侧栏**：14 项平铺拆成 概览 / 节点 / 出站 / 系统 四组，带分组标题；图标换成 MDI 线性（outline）变体；
  收起时只留图标，悬停展开才出文字（`--rail` 类在悬停时仍然存在，隐藏规则要用 `:not(--is-hovering)` 排除）。
- **内容区**：`View.vue` 里加 `.page-shell`，限宽 1240px 居中，宽屏上不再贴着左边缘散开。
- **清掉一条历史包袱**：`Default.vue` 里曾有全局 `.v-card-subtitle { text-align:center; border-bottom:1px solid gray }`，
  它让每张卡片的副标题都变成一条"灰线标题"——这才是廉价感最直接的来源之一。

### 全站一致性（第二轮）

- **一键主次**：所有页面的工具栏统一为「一个实心主操作 + 若干纯文字次操作 + 破坏性操作弱红」；
  原来 Outbounds / Relay / Settings 都是一排同色按钮，看不出该点哪个。
- **确认弹窗**：12 个文件里的 `error/success + outlined`（红绿描边）改成「实心红确认 + 文字取消」。
- **保存按钮**：Basics / DNS / Rules 原来用警告色描边当保存，语义是错的，改为主色实心。
- **首页**：四个快捷入口图标改前置、统一为轻量按钮，logo 从 200px 收到 132px。

踩坑：抽屉内容区默认是 `display:block`，直接给列表加 `flex/overflow` 不生效，必须先让
`.v-navigation-drawer__content` 变成 flex 列，列表才能真正滚动；否则 14 项会被裁掉一半。

## 监控默认开启 / 内核版本 / 节点更新

**监控默认开启**：首页的 CPU、内存、网络、内核状态四块卡片默认就渲染（存在 localStorage 的 `reloadItems`，
首次访问给默认值 `g-cpu,g-mem,h-net,i-sbd`），不用每次进来手动勾选。

**面板用的是什么内核**：内核（sing-box）**不是运行时下载的**，它在编译时静态链接进 `sui-agent` 二进制。
所以「内核版本」是每台节点自己的属性：

- agent 启动时用 `debug.ReadBuildInfo()` 读出 `github.com/sagernet/sing-box` 的版本，随每次上报带上来；
- 面板存进 `nodes.kernel_ver`，首页「Sing-Box Info」卡片显示 `Kernel v1.13.18`；
- Worker 每 6 小时查一次上游最新 release（缓存进 `meta`，避免打爆 GitHub 匿名限额），
  落后时在版本旁显示一个可点的 `⬇ v1.13.20` 标记。

**点更新会发生什么**：面板下发 `update_agent` 指令，payload 带 `{url, sha256, version}`。节点侧：

1. 下载到 `<自身>.new`
2. 校验 sha256（不匹配直接删除并报错，不动原文件）
3. `chmod 0755` + 原子 `rename` 覆盖自身
4. 上报回执后 `syscall.Exec` 用新二进制重启

任何一步失败都保留原二进制继续运行，不会把节点搞失联。指令只投递一次（`pending → sent`），
避免"更新→重启→再更新"的循环（这个循环实测踩过）。

**配置更新源**（面板不托管二进制：Workers 静态资源单 25MB 限制装不下 73MB）：

```bash
curl -X POST 'https://<面板>/api/release' \
  -b 'sui_session=<cookie>' \
  --data-urlencode 'url=https://your-cdn.example/sui-agent-linux-amd64' \
  --data-urlencode 'sha256=<sha256sum>' \
  --data-urlencode 'version=1.4.3-<构建号>'
```

之后在「Servers」页每张节点卡片上点下载图标即可推送更新。
