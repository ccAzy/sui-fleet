# 本地仲裁者（替代 Cloudflare Worker）

原 `apps/arbiter` 是部署在 Cloudflare 上的 Worker（`* * * * *` cron + KV）。免费档很容易
被它的定时触发吃穿配额，所以生产环境改成：**任意一台备用机上跑 systemd timer**，
逻辑相同、零外部配额。

## 部署（在备用机上执行）

```bash
install -d -m 700 /opt/sui-arbiter
install -m 755 apps/ops/arbiter-local/arbiter.sh /opt/sui-arbiter/arbiter.sh
install -m 644 apps/ops/arbiter-local/sui-arbiter.service /etc/systemd/system/
install -m 644 apps/ops/arbiter-local/sui-arbiter.timer   /etc/systemd/system/
# 需要切换时要能用运维令牌推进代次、用 DNS 令牌改 A 记录
install -m 600 /dev/stdin /opt/sui-arbiter/ops_token <<< "<OPS_TOKEN>"
systemctl daemon-reload && systemctl enable --now sui-arbiter.timer
```

## 行为

- 每 2 分钟探一次 `PROBE`（默认主控 `/health`）；
- 连续失败达到 `THRESHOLD`（默认 3）且过了 `COOLDOWN`（默认 600s）才动作；
- **默认 `DRY_RUN=1`**：只写 journal（`journalctl -t sui-arbiter`），不改 DNS、不推进代次；
- 要真切换：`DRY_RUN=0` + 放好 `/opt/sui-arbiter/cf_token`（需要 Zone.DNS 编辑权限）；
- 状态在 `/opt/sui-arbiter/state.env`（failures / last_switch / primary）。

## 注意

- 必须跑在**不是主控**的那台机器上，否则主控挂了它也不在。
- 切换后记得人工确认新主控的健康；`primary` 不会自动切回来。
