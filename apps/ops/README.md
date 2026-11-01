# sui-ops —— 控制面执行器

只跑在"面板主机"上，把 `promote.sh` 推到目标机执行。它**不碰 DNS**，切换仍由仲裁者做。

监听 `127.0.0.1:8790`（不对外），所有请求要带 ops token。

## 配置 `/etc/sui-ops.json`

```json
{
  "port": 8790,
  "token": "<OPS_TOKEN>",
  "panel_url": "https://panel.example.org",
  "ssh_key": "/root/.ssh/exec_ed25519",
  "ssh_port": 6688,
  "promote_script": "/opt/sui-panel/apps/selfhost/scripts/promote.sh",
  "targets": { "jp": "85.121.122.96", "vn": "198.51.100.20" }
}
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 自己是否活着（无令牌） |
| GET | `/targets?token=` | 允许的目标白名单 |
| POST | `/promote?token=&target=jp&dry=1` | 在目标机跑 promote；`dry=1` 只体检 |
