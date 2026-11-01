# 上游遗留的 CI / 模板（已移出仓库）

两个上游项目原先把自己的 CI 放在 `node/.github/` 与 `frontend/.github/`。
搬过来之后它们**永远不会被执行**：GitHub 只读仓库根的 `.github/`。

比“不生效”更麻烦的是会误导：`node/.github/workflows/release.yml` 按 `frontend/**`
过滤，而上游的 `node/frontend` 子模块在本仓库不存在——照着它调发布流程会白费时间。

因此这些文件已从当前树中移除，需要时可以从 git 历史或上游仓库取回：

```bash
git log --all --oneline -- node/.github | head     # 找到删除前的提交
git show <commit>:node/.github/workflows/release.yml
```text

真正在跑的流水线只有根目录的 `.github/workflows/ci.yml`（panel / frontend / node /
arbiter / selfhost 五个 job，外加 frontend-dist 与源码的一致性校验）。
