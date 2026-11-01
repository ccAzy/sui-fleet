# sui-arbiter —— 顺位接管的仲裁者

一个独立的 Cloudflare Worker：每分钟探测主控的 `/health`，连续失败达到阈值就按顺位表切 DNS 并推进 epoch。

**为什么是独立 Worker**：仲裁者必须活在"主控之外"。主控在 hk 时它跑在 CF；主控搬回 CF 时它仍在 CF，不冲突。

## 当前状态

- `DRY_RUN = "1"`：**只记录判定，不改 DNS、不推进代次**。
- 已部署：`https://sui-arbiter.<your-subdomain>.workers.dev/?token=<OPS_TOKEN>`
- 顺位表 `hk,jp`；`KV.ips` 已写入两台的真实 IP；探测地址 `https://panel.example.com/health`。

## 要真正接管，需要你出一样东西

**Cloudflare API 令牌**（Zone → DNS → Edit，作用域限定 `example.com`）。拿到后：

```bash
cd apps/arbiter
printf '%s' '<刚刚创建的令牌>' | npx wrangler secret put CF_API_TOKEN --config wrangler.toml
npx wrangler secret put ZONE_ID      --config wrangler.toml   # example.com 的 Zone ID
npx wrangler secret put RECORD_NAME  --config wrangler.toml   # 比如 panel.example.com
sed -i 's/^DRY_RUN = "1"/DRY_RUN = "0"/' wrangler.toml && npx wrangler deploy --config wrangler.toml
```

## 判定规则（纯函数，`src/decide.ts`，6 个单测）

| 情况 | 动作 |
| --- | --- |
| 探活成功 | 失败计数归零 |
| 失败但未到阈值（默认 3 次） | 只累计 |
| 到阈值且不在冷却窗口（默认 10 分钟） | 切到顺位里下一台，epoch +1 |
| 顺位里没有别的候选 | `exhausted`，不动 |

## 防脑裂

切主时 epoch +1 并回写面板 `meta.control_epoch`；被降级的实例重启后发现自己 epoch 落后，**只能以只读身份启动**（见 `apps/selfhost` 的启动校验）。因此"旧主控回来抢"这条最常见的脑裂路径被堵死。

## 不做自动回切

主控恢复后不自动切回，只在日志里留一条，由人在面板点一下才切回——误切比不切更麻烦。
