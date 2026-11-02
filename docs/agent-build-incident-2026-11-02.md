# 事故记录：agent 重建后 uTLS 缺失，10 台节点内核停摆（2026-11-02）

## 发生了什么

为了修「上报失败即丢流量」和「settings 变更也重启内核」，我改了 `node/cmd/agent.go`，
用本地 WSL 的 Go 1.26.5 + `CGO_ENABLED=1` + 标签
`with_quic,with_grpc,with_utls,with_acme,with_gvisor,badlinkname,tfogo_checklinkname0,with_tailscale`
编译出 56 MB 的 amd64 二进制（上一次部署的是 75 MB），滚动到 10 台并全部 `systemctl active`。

约 2 分钟后面板显示 `core_state=error` 10/10。节点日志：

```
initialize inbound[ 0 ] vless-reality-20678 uTLS, which is required by reality
is not included in this build, rebuild with -tags with_utls
```

**标签明明带了 `with_utls`，但运行时判定没有。** 结论：这个标签组合并不等价于线上那版
二进制；`core_state` 上报为 `error` 而不是 `stopped`，所以「agent active」骗过了我的验收。

## 怎么恢复的

1. 每台都有 `/opt/sui-agent/bin/sui-agent.prev`（部署脚本第一步就是备份它）。
2. **必须先 `systemctl stop` 再 `cp`**，否则 `Text file busy`（第一次回滚就卡在这里）。
3. hk 的 `.prev` 在第二次滚动时被覆盖成了坏版本 —— 从 jp **正在运行**的二进制反向拷回。
4. 恢复后校验：`running 10/10`、`alive 10`、10 台二进制 md5 一致（`cce10476`）。

## 现在的状态

- 生产：10/10 跑的是**已知可用**的旧二进制。
- 仓库：`node/cmd/agent.go` 已回到该版本；改动存成
  `docs/patches/agent-traffic-buffering.patch`（含流量缓冲 + 只在内核配置变化时才重启）。
- 这两项 agent 侧改进**尚未部署**，因为还没找到能产出「带 uTLS 且能起 reality」的构建配方。

## 下次动手前必须做的三件事

1. **先在一台上验证，别直接铺**：hk 换二进制 → 观察 `journalctl -u sui-agent | grep "sing-box started"`，
   再确认面板该节点 `core_state=running` 持续 3 分钟。只 `systemctl is-active` 不算通过。
2. **验收标准是「内核起来」不是「进程活着」**：`core_state` 里 `error` 与 `stopped` 都表示不可用。
3. **确认构建产物的能力集**：新二进制与线上版本对比 `strings -a bin | grep -c utls`
   （线上 1495 / 坏版本 1211），差异说明标签或依赖树不同；对不上就别发。

## 尚未查清的根因线索

- `scripts/build-wsl.sh` 的标签集与手工构建一致，但它在 `$HOME/build/sui-agent` 复制树上
  用 `GOPROXY=off` 构建，依赖 WSL 侧的 module cache；本机只有 Windows 侧缓存
  （`/mnt/c/Users/<user>/go/pkg/mod`），所以要显式 `GOMODCACHE` 才能编译。
- `with_naive_outbound` 依赖 cronet-go 预编译库，CGO 下会链接失败；`with_musl` 与 glibc 的
  静态链接又会冲突。可用的组合只在「CGO=1 + 不带 naive + 不带 musl」这一档，
  但正是这一档复现了 uTLS 缺失 —— 说明还有别的差异（未定位）。
- 下一步最稳的做法：在一台测试机上用 `go build` 出的二进制**跑一次 reality 入站**再谈发布。

## 后续（同日）：修好了，并补上验证流程

用同一套标签重新构建，产物是 **75,628,472 B**（与线上可用版本 75,624,376 B 只差补丁那 4 KB），
之前失败的两次产物都是 **56 MB** —— 说明问题出在构建环境而非标签本身（同一命令在
`node/web/html` 未被填充 / 不同 module 缓存状态下会产出不完整的能力集，具体触发条件仍未定位）。

这次的落地流程（值得固定下来）：

1. 在 hk 单机替换 → `journalctl -u sui-agent | grep "sing-box started"` 出现、`grep -c uTLS` 为 0
   → 面板该节点 `core_state=running` 持续 90 秒；
2. 全部通过后才铺其余 9 台，每台都校验 `md5 == 新包 md5`、`started ≥ 1`、`utls == 0`，
   任一不满足立即用 `.prev` 回滚并报告；
3. 结果：10/10 运行新二进制，代理正常。

**发布前的硬性预检（建议写进脚本）**：产物大小应与已验证版本同量级（±5 MB），
相差过大即视为能力集不同，直接拒绝发布。
