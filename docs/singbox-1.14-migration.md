# sing-box v1.13.18 → v1.14.4 迁移笔记（构建已验证失败，未动线上）

## 结论先说

v1.14 对 `adapter` 包做了**破坏性接口改版**，我们 fork 的 6 个协议实现全部无法编译。
不是配置问题、不是环境问题，是源码级迁移。线上 10 台仍跑 v1.13.18，**仓库 go.mod 也仍锁 v1.13.18**，
本次只失败了一次构建，没有任何东西被改坏。

构建环境（已验证可用）：shenzhou `~/.local/go/bin/go`(1.27.2) + `GOPROXY=https://mirrors.aliyun.com/goproxy/,direct`。
注意：`goproxy.cn` 从这台机器只有 **23 KB/s**，阿里云镜像 **5.9 MB/s**，别再用 cn。

## 三处接口差异（v1.14.4 源码实测）

| # | v1.13.18（我们现在的实现） | v1.14.4 | 影响面 |
| --- | --- | --- | --- |
| 1 | `Start(stage adapter.StartStage) error` | `Start(stage adapter.StartStage, scope *adapter.Scope) error` | 7 处 |
| 2 | `NewConnectionEx(ctx, conn, metadata, onClose)` | 接口改名 `NewConnection(ctx, conn, metadata InboundContext, onClose)` | 每个协议 1 处定义 |
| 3 | `adapter.NewUpstreamContextHandlerEx(...)` | `adapter.NewUpstreamContextHandler(...)`（返回 `UpstreamHandlerAdapter`） | 18 处调用点合计（含 #2） |

编译器原始报错：

```text
core/protocol/vless/inbound.go:35  *Inbound does not implement adapter.TCPInjectableInbound (missing method NewConnection)
core/protocol/vless/inbound.go:62  undefined: adapter.NewUpstreamContextHandlerEx
core/protocol/vless/inbound.go:97  *Inbound does not implement adapter.ConnectionHandler
core/protocol/vless/inbound.go:99  wrong type for method Start
core/protocol/hysteria2/inbound.go:144  wrong type for method Start
```text

## 迁移步骤（机械改，但有坑）

1. **只改定义侧**：把各协议 inbound 的 `func (...) NewConnectionEx(` 改成 `NewConnection(`。
   ⚠️ 不要全局 sed：v1.14.4 里 `NewConnectionEx` 作为**旧接口方法名仍然存在**
   （`adapter/upstream_legacy.go`），全局替换会把「调用上游 handler」的地方一起改坏。
2. **Start 加参数**：`func (h *Inbound) Start(stage adapter.StartStage) error`
   → `func (h *Inbound) Start(stage adapter.StartStage, _ *adapter.Scope) error`
   （`scope` 目前可以先不用，保持行为不变；7 处）。
3. **换 handler 构造**：`adapter.NewUpstreamContextHandlerEx(` → `adapter.NewUpstreamContextHandler(`，
   返回类型从 ex 版变成 `UpstreamHandlerAdapter`，若我们把它赋给具体类型的变量需要跟着改声明。
4. 逐个协议编译：vless → vmess → trojan → hysteria → hysteria2 → tuic。
5. 全绿后 `CGO_ENABLED=1 go build -tags "with_quic,with_grpc,with_utls,with_acme,with_gvisor,badlinkname,tfogo_checklinkname0,with_tailscale" -ldflags "-w -s -checklinkname=0"`，
   产物必须 **≥70 MB** 且含 `tailscale.com` / `uTLS` 符号（56 MB 的残缺包曾在 10 台上导致断流 6 分钟）。

## 发布与验证（构建通过后）

```text
产物 → hk:/opt/sui-panel/panel/frontend-dist/dl/sui-agent-linux-amd64.part-NN（25MB 分片）+ .parts + .sha256
→ 面板 POST /api/release {url, sha256(必填 64hex), version}
→ 先 hk 单台 POST /api/updateAgent
→ 验证三件：journalctl -u sui-agent | grep "sing-box started"；grep -c uTLS == 0；core_state=running 持续 90s
→ 再 POST /api/nodes/all/command kind=update_agent 铺其余节点
```text

## 待办：确认上游是否已适配

上游 `alireza0/s-ui` 若已支持 1.14，直接吸收它的 `node/core/protocol/` diff，比我们自己改可靠。
本次从三台机器都取不到 GitHub（本机代理 3067 已挂、hk 与 shenzhou 直连均失败），**这条信息仍缺**。
有代理时优先跑这一条：

```bash
curl -s https://raw.githubusercontent.com/alireza0/s-ui/main/node/go.mod | grep sing-box
```text
