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

## 迁移进展（第二轮，实测）

协议接口层已全部改完（可复用）：
- `NewUpstreamContextHandlerEx` → `NewUpstreamContextHandler`（4 处）
- adapter 的 `ConnectionHandler`：vless/vmess/trojan/anytls 加 `NewConnection`（委托 `NewConnectionEx`）；
  hysteria/hysteria2/tuic 保留 `NewConnectionEx`（sing-quic 的 `ServerHandler` 仍要此名）
- `Start(stage)` → `Start(stage, *adapter.Scope)`（7 处）
- hysteria：删除 v0.9.7 已移除的 `ConnReceiveWindow` / `StreamReceiveWindow` / `MaxIncomingStreams`

### 真正的深水区在 core/box.go（v1.14 重构了内核装配）

```text
core/log.go:86   *defaultFactory does not implement log.Factory (missing AttachPlatformWriter)
core/box.go:174  too many arguments in call to endpoint.NewManager
core/box.go:175  too many arguments in call to inbound.NewManager
core/box.go:176  too many arguments in call to outbound.NewManager
core/box.go:177  too many arguments in call to dns.NewTransportManager
core/box.go:178  too many arguments in call to boxService.NewManager
core/box.go:186  assignment mismatch: 1 variable but dns.NewRouter returns 2 values
core/box.go:194  not enough arguments in call to route.NewConnectionManager
core/box.go:515  adapter.Lifecycle has no Close
core/box.go:536  adapter.LifecycleService has no Close
```

这不是改签名，是**重写内核装配顺序**：五个 Manager 构造器、dns.Router、ConnectionManager、
Lifecycle 的关闭语义全变了。上游 s-ui 有完整适配（`core/box.go` + `core/log.go` + 自建的
`core/quicgrace/`），可行路径是整套搬过来再把我们的补丁（clients_sig、nameAt 越界保护、
sendbox 自定义）重贴回去。

结论：**这不是 1–2 小时的活**，是半天级、且改的是代理的内核启动链路。
在当前 v1.13.18 无故障、1.14 无我们必需功能的前提下，投产比不成立。

## 内核在线更新链路：已接通（停在 1.13.18）

按 `self-update-script-engineering` 技能的审计视角做了一遍，现状：

| 环节 | 状态 | 说明 |
| --- | --- | --- |
| 分发目录 | ✅ 已修 | `/dl/sui-agent-linux-amd64` 原来是 **25.8MB 的残缺拼接物**（分片 part-00/01 拼出来的，与生产 75.7MB 不符）。已换成正确产物：**75,698,488 B，md5 38ee74d65728**，sha256 `fdf7da11…` |
| 分片 | ✅ 重建 | 24MiB × 3 + 200KB × 1，共 4 片；`.parts`=4；`.sha256` 与完整包一致 |
| 更新源 | ✅ 已写 | meta 三件套：`agent_release_url=https://sui.example.com/dl/sui-agent-linux-amd64`、`sha256=fdf7da11…`、`version=1.4.2` |
| 可达性 | ✅ 验证 | `HEAD` → 200 octet-stream；`.parts`→4；`.sha256` 首段 fdf7da11 |
| 鉴权 | ✅ 正常 | `/api/release` 未登录返回 `{"success":false,"msg":"Invalid login"}`（HTTP 200 是面板统一 envelope 约定，不是放行） |
| 界面按钮 | ⏸ 不显示（正确） | `outdated` 判据是 `agent_ver !== release_version`，当前两边都是 1.4.2 → 没有"可更新"。有新版本时才会出现 ↓ |

### 还缺的一块（下次动这条链路前必须补）

`selfUpdate()` 的失败路径只覆盖到"替换二进制"这一步：

```text
下载 → 校验 sha256 → 旧文件改名 .old → 新文件顶上 → re-exec
```

**新二进制启动后崩溃时不会自动回滚**——systemd 只会反复重启那个坏二进制。技能里 P0-1
"失败路径必须恢复服务"要求的是：re-exec 后若 N 秒内没上报成功（面板侧 `core_state=running`

+ 新 `agent_ver`），节点侧要自动 `cp sui-agent.old sui-agent` 再启动一次。

另外按技能 P0-2/P0-3，节点侧还缺状态文件与锁（并发点两次"更新"会出问题）。
这两项要在真正启用自动更新之前做完。

## 意外发现：构建不可复现（比 arm64 更基础）

做 arm64 适配时撞上的，与架构无关：

同一份 **master 源码**、同一个 go.mod/go.sum，在 shenzhou 上 **amd64 也编不过**：

```text
github.com/go-json-experiment/json@v0.0.0-20250813024750-ebf49471dced/alias.go:618
  undefined: json.SkipFunc
alias.go:957
  undefined: json.DiscardUnknownMembers
```

已排除的因素（逐项实测）：

| 变量 | 试过的值 | 结果 |
| --- | --- | --- |
| Go 版本 | 宿主 1.27.2 / 容器 golang:1.27.3 / golang:1.27.2 | 同错 |
| GOEXPERIMENT | 空 / `jsonv2` | 同错 |
| 模块模式 | `-mod=mod` / `-mod=readonly` | 同错 |
| 架构 | amd64 / arm64 | 同错 |

结论：`go-json-experiment/json` 这个版本要求比 Go 1.27 更新的标准库实验 API。
线上那份 75,698,488 B 的二进制是 11-02 在**另一个缓存环境**里编出来的 ——
说明 `go.sum` 没能真正锁住依赖树，`-mod=mod` 在不同机器上会解析到不同版本。

影响：开源后别人 clone 大概率也编不出来。这是"别人达不到同样水准"最硬的障碍，
比 arm64 更该先修。

修法（按彻底程度）：

1. `go mod vendor` —— 依赖固化进仓库，clone 即编（体积 +几十 MB，但最可靠）
2. pin `go-json-experiment/json` 到与 Go 1.27 API 匹配的版本（要验证 sing-box 是否兼容）
3. 统一工具链镜像 + `-mod=readonly`（治标：换机器仍可能漂）

arm64 本身不是问题：`scripts/build-wsl.sh` 里早就有 `GOARCH=arm64 CC=aarch64-linux-gnu-gcc`
分支，qemu binfmt 也已在 shenzhou 注册好（`docker run --platform linux/arm64` 能跑 aarch64）。
构建一旦可复现，arm64 只是加一行 GOARCH。

## arm64 适配：完成（2026-11）

**根因不是架构，是 Go 版本。** `go-json-experiment/json@v0.0.0-20250813024750`
用的是 Go **1.26** 的 `encoding/json/v2` 实验 API（`SkipFunc`、
`DiscardUnknownMembers`），**Go 1.27 把它们移除了** —— 所以同一份源码在
Go 1.27.2 上 amd64 也编不过（和架构无关）。

> 这个约束其实早就写在 `scripts/build-wsl.sh` 里了：
> “go.mod 要求 go 1.26.5；用 1.27 编译会在 go-json-experiment/json 上炸”。
> 这次因为没先读构建脚本，绕了一大圈才发现。**下次改构建先读脚本。**

### 构建方法（arm64）

宿主 Go 用 1.26.5，交叉编译器由容器提供（shenzhou 上没有 aarch64 gcc）：

```bash
docker run --rm --network host \
  -v "$PWD/node":/src -w /src \
  -v "$HOME/.local/go1265":/opt/hostgo:ro \
  -v "$HOME/go/pkg/mod":/gomod \
  -e GOMODCACHE=/gomod -e GOFLAGS=-mod=mod -e GOTOOLCHAIN=local \
  -e GOPROXY=https://mirrors.aliyun.com/goproxy/,direct \
  golang:1.27.2 bash -c 'apt-get install -y gcc-aarch64-linux-gnu
    export PATH=/opt/hostgo/bin:$PATH
    CGO_ENABLED=1 GOOS=linux GOARCH=arm64 CC=aarch64-linux-gnu-gcc \
      go build -tags "with_quic,with_grpc,with_utls,with_acme,with_gvisor,badlinkname,tfogo_checklinkname0,with_tailscale" \
      -ldflags "-w -s -checklinkname=0" -o /src/sui-agent-arm64 .'
```

qemu 运行验证需要先注册 binfmt（shenzhou 已注册）：
`docker run --privileged --rm tonistiigi/binfmt --install arm64`

### 产物与验证

| 项 | 值 |
| --- | --- |
| 大小 | 70,287,936 B（门禁 ≥70MB 通过） |
| 架构 | `ELF 64-bit LSB executable, ARM aarch64` |
| md5 | e497a0446445 |
| 符号门禁 | tailscale 68 处、uTLS 6 处 |
| qemu 实跑 | `S-UI Panel 1.4.2 / Sing-Box v1.13.18` |
| 发布 | `/dl/sui-agent-linux-arm64`（完整包）+ 3 分片 + `.parts` + `.sha256`（1a3956cc…） |

`install.sh` 已撤掉「暂不支持 ARM64」的拦截，arm64 机器现在走正常安装路径。

**未验证的**：真 arm 硬件上没跑过（只有 qemu）。真机若起不来，先看
`journalctl -u sui-agent`，常见是 libc/内核版本不匹配。

## 端口跳跃：服务端已实现并单台验证通过

面板侧本来就有：入站编辑的「拨号」(out_json) 能填 `server_ports`，
`links.ts` 也会生成 `mport=...` 的分享链接。缺的只是服务端 NAT。

新增 `node/core/port_hop.go`（`f243a2e`）：读 `hysteria/hysteria2/tuic` 入站的
`out_json.server_ports` + `listen_port`，生成独立表 `inet sui_hop` 的 dnat 规则，
`Core.Start()` 成功后重建（nft 规则不持久化），失败只告警。

### 单台实测（hk）

```text
INFO - 端口跳跃已生效： 1 条规则（表 inet  sui_hop ）

table inet sui_hop {
 chain prerouting {
  type nat hook prerouting priority dstnat; policy accept;
  udp dport 40000-42000 dnat to :44368
 }
}
```

### ⚠️ 踩到的坑：手工改库必须写 blob，不能写 text

用 JS 把 `out_json` 存成字符串时：

```text
agent: restart core: sql: Scan error on column index 5, name "out_json":
unsupported Scan, storing driver.Value type string into type *json.RawMessage
```

gorm 的 `json.RawMessage` 要求 **blob（[]byte）**，写 text 会让整个内核重启失败
（当时 hk 真的短暂断流）。改成 `Buffer.from(json)` 即正常。

**结论：不要手工改 s-ui 的库来验证配置 —— 走面板 API（有正确的序列化）。
手工改还有个副作用：agent 会从面板拉配置覆盖回去。**

### 现状（未启用）

+ 代码在 master，单台验证过，但 hk 已**回滚**（`out_json=NULL`），
  因为 40000-42000 段的安全组/防火墙还没放通 —— 先开口子再启用，否则客户端
  跳过去就是丢包，比不开更差。
+ 新 agent（75,678,000 B，md5 24a10fd31c65）尚未发布到 `/dl`，其余 9 台仍是旧版。

## 端口跳跃：全量上线完成（10 台）

### 改用 iptables（不是 nft）

最初用 nft `inet sui_hop`，但节点上早就有历史 dnat 规则（我们自己早期脚本配的，
持久化在 `/etc/iptables/rules.v4`，`netfilter-persistent` 开机恢复）。nft(inet) 与
iptables(ip nat) 都挂 prerouting/dstnat，**谁先命中取决于内核注册顺序、不可控** →
会出现「面板改了端口但实际走老规则」。统一到 iptables，并把 `SUI_HOP` 用
`-I PREROUTING 1` 插到第 1 位，顺序才确定（顺带消除 vn 上「同一段两条 dnat」的歧义，
不必删历史规则）。

### 实测结果

| 项 | 结果 |
| --- | --- |
| 10 台 agent | 全部 `active` + `sing-box started`，旧二进制备份 `sui-agent.old2` |
| 规则 | 10/10 台 `dnat=2`（hysteria2 `40000:42000`、tuic `43000:45000`）、`PREROUTING` 第 1 位 |
| **外部发包实测** | 从本机向 hk 40001/40099/43001/44999 发 UDP → 两条规则 `pkts` 各 0→2、字节 120/2=60（32 payload+28 头）完全对上 |
| 持久化 | `netfilter-persistent save` → `/etc/iptables/rules.v4` 3 行 |
| 订阅链接 | `/sub/all` 里 **10 条** hysteria2 链接全部带 `mport=40000%3A42000` |

### ⚠️ 踩到的第二个坑：订阅返回的是「存下来的 uri」，不是实时生成

改完 inbound 的 `out_json.server_ports` 后订阅**毫无变化**。根因：`/sub/*` 直接吐出
`clients.links[].uri`（`objects` 表里存好的字符串），而那是上次 `recomputeLinks()`
（`panel/src/objects.ts:154`，由 `api-write.ts:82` 在保存客户端时触发）生成的旧值。

**更正：这不是面板缺陷。** `objects.ts:428` 的 `saveObject()` 在保存 `inbounds` /
`clients` / `tls` 之后会自动 `await recomputeLinks(...)` —— 走 UI 保存的话订阅会立刻更新。

出现"改了没变"是因为**用脚本直接改库，绕过了 `saveObject`**，自然没有重算。
所以：脚本改库（运维手段）必须自己补一次重算；正常从界面改不受影响。

另外实测 `genLinks()` 是**对的**：传入 `out_json.server_ports = ["40000:42000"]`
时它输出 `mport=40000:42000`（完整范围）。我曾经因为它只显示 `mport=40000`
误判成截断 bug —— 实际是我 `slice(0,170)` 把调试输出截短了。**调试输出不要截断
被验证的字段。**
