# 贡献指南

## 环境

| 部分 | 要求 |
| --- | --- |
| 面板 / 自托管 | Node ≥ 22.5（用到 `node:sqlite`）、npm |
| 前端 | Node ≥ 18 |
| 节点 agent | Go 1.26.5 + gcc（CGO 用于 sqlite） |

国内网络访问 npm 官方源会超时，用镜像即可，不必改全局配置：

```bash
npm ci --registry=https://registry.npmmirror.com
```text

## 改动前先跑这些

```bash
cd panel && npx tsc --noEmit && npx vitest run test/unit/     # 16 条纯函数单测
cd ../apps/arbiter && npm test                                # 6 条
cd ../apps/selfhost && npx tsc --noEmit -p tsconfig.json       # 同时校验 panel/src
bash -n $(git ls-files '*.sh')                                # shell 语法
```

端到端用例（52 项）需要空库 + 可登录实例，步骤见 README 的「e2e 怎么跑」。
**注意每次要用新库**，跑完管理员密码已被改掉。

## 前端产物的特殊约定

`panel/frontend-dist/` 是**提交进仓库的构建产物**（Cloudflare 的
「Deploy to Cloudflare」按钮要求子目录自包含）。所以：

> 改了 `frontend/src/**` 之后，必须执行 `bash panel/build-frontend.sh` 并把产物一并提交。

CI 会校验产物与源码一致，不一致直接红。这条不是形式主义：
线上部署直接用产物，忘了重建就会出现「CI 全绿、线上还是旧 UI」。

## 提交

- 一个提交一件事，commit message 说清「为什么」而不是「改了什么」。
- 修 bug 时如果能在 `panel/test/unit/` 加一条纯函数用例，请加上。
- 涉及 SSH / 防火墙 / 路由 / 内核启动的改动，必须在提交说明里写清回滚方法。
- 不要提交 `.data/`、`wrangler.local.toml`、`*.db`、`panel/frontend-dist/dl/`。

## 上游关系

本项目派生自 s-ui（GPL-3.0），协议渲染、链接生成等逻辑沿用其语义。
改动 `panel/src/links.ts` / `clash.ts` / `singbox.ts` 时，
注意 `node/util/genLink.go` 里还有一份平行实现——两边不一致会导致
「面板订阅有、节点自带订阅没有」的静默分叉。
