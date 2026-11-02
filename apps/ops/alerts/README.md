# 告警守护（alertd）+ 命令机器人（bot）

两个进程共用一个 Telegram bot：

| 进程 | 方向 | 作用 |
| --- | --- | --- |
| `alertd.sh` + timer（每 2 分钟） | 单向**推** | 故障告警 + 每日心跳 |
| `bot.mjs` + service（长轮询） | 双向**问答** | 在 TG 里查：`/status` `/nodes` `/node <id>` `/traffic` |

互不冲突：alertd 只调 `sendMessage`，bot 独占 `getUpdates`。

## 命令机器人

`bot.mjs` 用 Node 24 内置的 `node:sqlite` 以只读方式直开面板库，不走内网 HTTP、不需要任何令牌。

- **只回应白名单里的 chat_id**（`TG_CHAT_ID`，逗号分隔可多个）；其他人发消息一律不回，并在日志里记一行。
- **纯只读**：没有任何改配置、重启内核的入口。
- 以系统用户 `sui` 运行（与面板同权限）；`/etc/sui-alert.env` 由 systemd 以 root 读取并经 `EnvironmentFile` 注入，进程本身不碰该文件。

命令：

```text
/status          面板健康 + 节点总览（运行数、上报数、累计流量）
/nodes           逐台列出：状态灯、id、名字、最后上报多久前
/node <id或名字>  单台详情：版本、applied/revision、流量
/traffic         流量 Top 5
/help            帮助
```

安装：

```bash
install -m 644 apps/ops/alerts/sui-bot.service /etc/systemd/system/
install -m 755 /dev/stdin /opt/sui-alert/bot.sh <<'SH'
#!/bin/bash
set -u
export TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
export TG_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
export DB=/opt/sui-panel/data/sui.db
exec /opt/node/bin/node /opt/sui-alert/bot.mjs
SH
systemctl daemon-reload && systemctl enable --now sui-bot
```

## 告警守护（alertd）

轻量、零依赖：一个 bash 脚本 + systemd timer，每 2 分钟检查一次。

### 装在哪

| 机器 | 作用 | 检查什么 |
| --- | --- | --- |
| 主控（hk） | 主力告警 | 本机 `/health`、每个启用节点的 `core_state` 与 `last_seen`、根分区使用率 |
| 备用（jp） | 双保险 | 公网 `https://<域名>/health`（主控整机宕机时只有它能喊） |

直读 sqlite 而不是调 API：不需要只读令牌（会过期/被删），面板挂了也照样能探活。

### 通知渠道

编辑 `/etc/sui-alert.env`（600），支持三种，可同时开：

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...     # @BotFather 建 bot
TELEGRAM_CHAT_ID=123456789           # 先给 bot 发条消息，再从 getUpdates 拿 id
WEBHOOK_URL=https://example.com/hook # POST {"text": "..."}
BARK_URL=https://api.day.app/<key>   # iOS Bark
```

一个都不配时，告警只追加到 `/var/log/sui-alerts.log`，行首标 `LOCAL`（不静默吞掉）。
配好后立刻验证：

```bash
HEALTH=http://127.0.0.1:1/health /opt/sui-alert/alertd.sh   # 强制失败一次
tail -2 /var/log/sui-alerts.log                             # 应看到 SENT [CRIT]
sed -i '/^panel_down=/d' /var/lib/sui-alert/state.env       # 测完清冷却，别挡住真告警
```

### 规则

- 节点失联 > `OFFLINE_SECONDS`（默认 300s）→ CRIT
- 节点 `core_state != running` → WARN
- 面板 `/health` 不通 → CRIT
- 根分区 ≥ `DISK_PCT`（默认 90%）→ CRIT
- 同一告警 `COOLDOWN`（默认 1800s）内不重复；恢复后自动清状态
- **每日 09:00 心跳**一条「面板正常，N 个启用节点，M 个运行中」——
  没有异常时也要能证明监控本身还活着

状态在 `/var/lib/sui-alert/state.env`，日志 `/var/log/sui-alerts.log`（logrotate 1MB × 3）。

> 注意：`EnvironmentFile` 由 systemd 直接解析，**不做 shell 展开**。这个文件里要写死值；
> 需要「显式传参优先」的写法（如 `${HEALTH:-...}`）只对 alertd 的 bash `source` 有效。
