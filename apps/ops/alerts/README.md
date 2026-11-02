# 告警守护（alertd）

轻量、零依赖：一个 bash 脚本 + systemd timer，每 2 分钟检查一次。

## 装在哪

| 机器 | 作用 | 检查什么 |
| --- | --- | --- |
| 主控（hk） | 主力告警 | 本机 `/health`、每个启用节点的 `core_state` 与 `last_seen`、根分区使用率 |
| 备用（jp） | 双保险 | 公网 `https://<域名>/health`（主控整机宕机时只有它能喊） |

直读 sqlite 而不是调 API：不需要只读令牌（会过期/被删），面板挂了也照样能探活。

## 通知渠道

编辑 `/etc/sui-alert.env`（600），支持三种，可同时开：

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...     # @BotFather 建 bot
TELEGRAM_CHAT_ID=123456789           # 先给 bot 发条消息，再从 getUpdates 拿 id
WEBHOOK_URL=https://example.com/hook # POST {"text": "..."}
BARK_URL=https://api.day.app/<key>   # iOS Bark
```

一个都不配时，告警只追加到 `/var/log/sui-alerts.log`，并在行首标 `LOCAL`。
配好之后可以立刻验证：

```bash
HEALTH=http://127.0.0.1:1/health /opt/sui-alert/alertd.sh   # 强制失败一次
tail -2 /var/log/sui-alerts.log                              # 应看到 SENT [CRIT]
```

## 规则

- 节点失联 > `OFFLINE_SECONDS`（默认 300s）→ CRIT
- 节点 `core_state != running` → WARN
- 面板 `/health` 不通 → CRIT
- 根分区 ≥ `DISK_PCT`（默认 90%）→ CRIT
- 同一告警 `COOLDOWN`（默认 1800s）内不重复发；恢复后自动清状态
- **每日 09:00 心跳**一条「面板正常，N 个启用节点，M 个运行中」——
  没有异常时也要能证明监控本身还活着

状态在 `/var/lib/sui-alert/state.env`，日志 `/var/log/sui-alerts.log`。
