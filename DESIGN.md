---
version: alpha
name: s-ui Cloud 账簿
description: 黑曜石 / 冷白纸双主题，紫蓝渐变强调。账簿式名录 + 体检单为结构骨架，卡片靠渐变面与双层阴影立起来。
colors:
  primary: "#14141a"
  secondary: "#55555f"
  tertiary: "#6d5ce0"
  neutral: "#f5f5f9"
  paper: "#f5f5f9"
  surface: "#ffffff"
  surface-2: "#eeeef4"
  ink: "#14141a"
  ink-2: "#55555f"
  ink-3: "#6b6b75"
  rule: "rgba(20, 20, 26, 0.085)"
  rule-strong: "rgba(20, 20, 26, 0.15)"
  accent: "#6d5ce0"
  accent-2: "#3b82f6"
  error: "#c42550"
  ok: "#0a7d45"
  warn: "#b45309"
typography:
  display:
    fontFamily: "Source Han Serif SC"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.25
  heading:
    fontFamily: "Source Han Serif SC"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Segoe UI Variable Text"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI Variable Text"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "Segoe UI Variable Text"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: "Cascadia Mono"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
rounded:
  sm: 6px
  md: 9px
  lg: 12px
  xl: 14px
spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s6: 24px
  s8: 32px
  s12: 48px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px
    height: 32px
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px
    height: 32px
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 40px
  rule-divider:
    backgroundColor: "{colors.rule}"
    size: 1px
  ledger-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: 9px
  ledger-row-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  ledger-mark:
    backgroundColor: "{colors.ok}"
    size: 6px
  ledger-mark-down:
    backgroundColor: "{colors.paper}"
    size: 6px
  ledger-meta:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.data}"
  ledger-state:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-3}"
    typography: "{typography.micro}"
  alert-error:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.error}"
    typography: "{typography.label}"
  alert-ok:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ok}"
    typography: "{typography.label}"
  alert-warn:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.warn}"
    typography: "{typography.label}"
  panel-title:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
  placeholder:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  page-background:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
  section-divider:
    backgroundColor: "{colors.rule-strong}"
    size: 1px
---

# DESIGN.md — s-ui Cloud

> 从已建成的实现反写的视觉系统，不是预先设定的规则书。改动界面时以本文件为准。

## 世界（2026-11 改为 Obsidian）

**白天**：冷白纸（#f5f5f9）+ 紫墨强调（#6d5ce0）。
**夜间**：黑曜石（#070708）+ 紫蓝辉光（--accent #8b7bff → --accent-2 #4ea8ff）。

和上一版「纸面/账簿」的区别：上一版把「克制」做成了「什么都不画」——
去掉边框、去掉阴影、去掉颜色，只剩骨架，读起来像毛坯房。这一版承认
界面需要有质感：

- 底色不是平涂：两层很淡的径向光晕 + 3% 噪点，给纵深
- 卡片靠**渐变填充 + 顶部 1px 高光 + 双层阴影**立起来，不靠画框
- 强调色是**渐变**，不是单一颜色：按钮、数字、选中项都用 --accent → --accent-2
- 读数用等宽大数字（27px）+ tabular-nums，单位小一号
- 状态靠**带光晕的墨点**（实心=在线，空心=离线，琥珀=告警）

保留的东西：衬线标题、等宽数据、账簿式名录的行结构与列对齐。
账簿仍然是骨架，只是现在它印在好纸上，而不是草稿纸。

## Token

### 颜色（浅色 / 深色）

新一代 token（与 `styles/paper.css` 同步）：

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--paper` | `#f5f5f9` | `#070708` | 页面底 |
| `--surface` | `#ffffff` | `#0e0e12` | 卡片 / 面板 |
| `--surface-2` | `#eeeef4` | `#16161c` | 次级容器 |
| `--ink` | `#14141a` | `#f0f0f4` | 正文 |
| `--ink-2` | `#55555f` | `#b6b6c2` | 次级说明 |
| `--ink-3` | `#6b6b75` | `#82828f` | 三级 / 占位（浅 4.85:1、深 5.08:1，均过 AA） |
| `--rule` | `rgba(20, 20, 26, 0.085)` | `rgba(255, 255, 255, 0.075)` | 1px 细线 |
| `--rule-strong` | `rgba(20, 20, 26, 0.15)` | `rgba(255, 255, 255, 0.2)` | 更明确的分界 |
| `--accent` | `#6d5ce0` | `#8b7bff` | 强调色（渐变起点） |
| `--accent-2` | `#3b82f6` | `#4ea8ff` | 强调色（渐变终点） |
| `--error` | `#c42550` | `#fb7185` | 异常（浅 5.18:1） |
| `--ok` | `#0a7d45` | `#34d399` | 正常（浅 4.79:1） |
| `--warn` | `#b45309` | `#fbbf24` | 降级 |

卡片专用（只有卡片元素读这组）：

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--card-bg` | 白到 `#fcfcfe` 渐变 | 白 5% 到 1% 渐变 | 卡面 |
| `--card-line` | `rgba(20, 20, 26, 0.08)` | `rgba(255, 255, 255, 0.075)` | 卡边 |
| `--card-highlight` | 内高光 | 内高光 | 顶部 1px |
| `--card-shadow` | 双层柔和阴影 | 内高光 + 外阴影 | 浮起 |
| `--glow-1` / `--glow-2` | 紫/蓝淡雾 | 紫/蓝辉光 | 页面背景光晕 |

旧的纸面 token（`--rule`、`--surface` 等）全部保留，语义不变，只换了值。

### 字体

| 角色 | 字体栈 | 说明 |
| --- | --- | --- |
| 标题 | 思源宋 / Noto Serif SC / Songti SC / Georgia | 衬线是这个世界的声音，页面上所有 h1/h2/区块标题用它 |
| 正文 | Segoe UI Variable / PingFang SC / Noto Sans SC | 系统 UI 字，产品界面不需要 display 字配对 |
| 数据 | Cascadia Mono / SF Mono / Consolas | 端口、IP、流量、ID、表格数字，全部 `tabular-nums` |

字号刻度固定（不用 clamp）：11 / 12 / 13 / 15 / 19 / 26 px。产品界面用户在同一 DPI 下看，流体字号只会让侧栏里的标题变形。

### 间距与形状

- 间距基数 4：4 / 8 / 12 / 16 / 24 / 32 / 48
- 圆角分三档：控件 9px（按钮、输入框、下拉）、卡片 12px、弹窗 14px、chip 6px
- 阴影：卡片用**双层柔和阴影**（深色下是第一层内高光 + 外阴影）浮起；
  弹窗用更大的 `--shadow-float`。不再有「页面内禁止阴影」这条——
  那是上一版把卡片压成色块的原因

## 标志性动作：账簿式名录

`.ledger` / `.ledger-row`（`styles/paper.css`）是全站最有辨识度的结构，用于所有「同类对象列表」（入站、节点、用户、规则）：

```text
◦ vless-reality-46250     :46250 · vless · TLS · 1 用户
◦ hysteria2-50381         :50381 · hysteria2 · TLS · 1 用户
```

四列固定：状态列（轨道 14px，墨点本体 6px）、名称（衬线）、参数（等宽数字 + `·` 分隔）、状态文字。行高 36–40px，1px 细线分隔，hover 时整行染 `--accent-soft`，操作按钮默认透明、hover 才出现（账目不需要满屏图标）。

状态不靠颜色单独传达：实心墨点 = 在线，空心 = 离线，另配文字。

## 第二个标志性动作：体检单（.sheet）

Home 不是仪表盘。一台机器是一张体检单：**抬头一行、读数一栏、曲线一栏、两列对账**。

```text
● HK-01  sing-box v1.13.18                         [信息卡][备份][日志][用量]
────────────────────────────────────────────────────────────────────
CPU 占用    内存占用      磁盘占用      交换区占用
 12.5%        3.2GB          -             -
 ▬▬▬          ▬▬▬▬▬▬        ▬▬▬▬▬         ▬▬▬▬▬      ← 3px 刻度尺
              of 8 GB · 40%
────────────────────────────────────────────────────────────────────
CPU 使用率                      内存使用率
 ╱╲╱                           ╱╲
────────────────────────────────────────────────────────────────────
系统                    |  内核
主机  HK-01             |  运行  是 · 重启
CPU   4 核              |  版本  v1.13.18
```

规则：

- **数字是主角，形状不承载信息**。半圆仪表盘只在「有上限且常年接近上限」时才有意义；8 台机器里 7 台恒为 0 的空半圆，占了四个方块的位置却什么都不说。同一份数据落在账簿上是「一个数 + 一把尺」。
- 读数格四列等宽，中间用 1px 竖线分隔，**不画卡片边框、不画背景**。刻度尺 3px，超过 70% 转 `--warn`、超过 90% 转 `--error`。
- 曲线是**一根线**，不是坐标纸：无竖网格、无点、无边框，横网格 10% 透明度。带宽独占整行，因为它是唯一有时间序列意义的量。
- 数据缺位写 `-`，不留空半圆、不画空框。
- 页面抬头 `● 名称 · 身份信息`，动作在最右侧，用最轻的 text 按钮。

## 列表页的统一收口（.page-toolbar）

所有列表页的工具条**右对齐**、下面一条 `--rule-strong` 细线收口、页名在顶栏左侧。上一版每页把自己那排按钮居中浮在列表上方：按钮位置跟着页面跳，扫视时每次都要重新找。

## 壁纸层：桌面与纸

壁纸默认关闭。开启后世界变成两层：**桌面**（页面底，可以是一张照片）和**纸**（内容区，永远不透明）。

```text
┌──────────────────────────────────────────────┐  桌面：壁纸
│  ┌────────────────────────────────────────┐  │
│  │ ● HK-01  sing-box v1.13.18             │  │  纸：--surface，1px 边框
│  │ CPU 占用  内存占用  磁盘占用  交换区   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

三条规则，不能让步：

0. **壁纸不能只是一条横幅**。第一版把内容区做成一张几乎顶满视口的实心纸，
   顶栏和侧栏又是不透明的，结果壁纸只在顶上露出一条——像屏风挡住墙。
   现在：顶栏/侧栏半透明带模糊（76%/84%），纸收窄到 `min(1080, 100%-120px)`、
   左右各留出桌面，纸面带 94% 的"薄纸"通透感 + 一层离地阴影（壁纸模式唯一允许的阴影），
   纸的明暗会跟着壁纸走，而不是一块死白。

1. **纸永远不透明**。滑块调到极限也只在「桌面」上生效。让表格浮在照片上，字就读不清了——这不是风格问题。
2. **开壁纸时内容区变成一张纸**（`width: min(1240px, 100% - 56px)` + 1px `--rule` 边框 + 四周至少 28px 桌面）。不起这一步，Home 的读数会直接压在图上。
3. **纸纹让位**：纸纹层 `--wp-grain` 从 0.025 压到 0.008。两种纹理叠一起是脏，不是丰富。

控件：模糊 0–40px、清晰度（对比 80–140% / 饱和 0–160%）、遮罩 0–85%、填充/完整、深浅各一张图。

**对比度守门**：按图片 4×4 网格里**最亮的一格**估算（深色字最怕亮块），低于 4.5:1 报红并给「一键修正」。白图配浅色主题不算问题（17.4:1），黑图配浅色主题才是（1.2:1）——所以不能只看平均亮度。

**半透明面板**（`backdrop-filter`）有两档：基础档 94%（壁纸模式默认，几乎不透但能感到纸后有色）；开关打开后 86% + 更强模糊，壁纸真正透进内容区。档位差 8 个百分点是刻意保留的——78% 时照片亮部会把 13px 的 `--ink-3` 说明文字压到 3:1 附近。

## 组件语言

- **按钮**：9px 圆角。主操作 = 紫蓝渐变（`--accent` → `--accent-2`）+ 顶部内高光 +
  hover 上浮 1px；次级 = 1px 描边 + 半透明底；文本按钮只有 hover 时才有底色
- **表单**：9px 圆角、半透明底；聚焦时边框转 `--accent` 并加 3px `--accent-soft` 光晕；
  标签 9.5px 大写、0.15em 字距
- **卡片**：`--card-bg` 渐变面 + 1px `--card-line` + `--card-shadow`；
  hover 时上浮 2px、阴影加深。卡片右上角可以放一团 `--glow-*` 模糊光
- **表格**：整块作为卡片（12px 圆角 + 边框 + 阴影），表头 9.5px 大写字距、
  不铺底色，行 1px 细线、hover 淡染
- **Chip**：6px 圆角、20px 高、等宽数字；只承载数据，不做装饰
- **浮层**：14px 圆角 + `--shadow-float`；弹窗标题衬线 16px、标题下不画分隔线
  （靠间距分层），底部按钮区有极淡底色收口
- **列表**：`.ledger` 整体作为卡片容器，行 hover 时左侧浮出 2px 渐变竖条

## 动效

- 卡片 hover：`transform: translateY(-2px)`，200ms，`cubic-bezier(.16,1,.3,1)`
- 按钮 hover：上浮 1px + 阴影加深，160ms；`:active` 回弹 `scale(.99)`
- 账簿行进场：220ms 位移淡入（保留上一版的编排，不额外加）
- 输入框聚焦：边框 + 光晕过渡 160ms
- 不做：bounce/elastic、无限循环动画、滚动视差

## 浏览器表面（会被漏掉但决定「是做的还是拼的」）

`::selection` 用 accent 底 + 纸色字；`caret-color` 用 accent；滚动条细、滑块 `--rule-strong`；`:focus-visible` 是 1px accent 描边 + 2px offset。这些都在 `paper.css` 里，改主题时一起改。

## 不做（这些是两版各自的反面参考）

**上一版（纸面极简）做成了毛坯房**，教训是：

- 把「克制」理解成「什么都不画」——无阴影、无渐变、无颜色，只剩骨架
- 卡片压成 1px 色块，读起来像表单系统而不是成品界面
- 2px 直角用在全站，控件没有反馈感

**现在这版要避免滑向另一头**：

- 霓虹发光、彩虹渐变、彩色光斑堆满屏
- emoji 当图标（用 lucide / mdi）
- 装饰性插图、无意义的动效
- 纯黑纯灰（墨色带一点冷，纸白带一点紫）
- 卡片套卡片、卡片堆成网格代替列表
- 标题上方的 kicker/eyebrow

**始终守住的**：数字是主角、异常一眼可见、账目能一行行扫过去。

## 节点切换器（顶栏下拉，2026-10-31）

机器到十台以后，「顺序扫一眼」比「找那台」更费神，所以下拉顶部加一行排序，而不是做成筛选器弹窗。

- **三个键**：名称 / 最近在线 / 状态。栏内三等分，选中项只加一条 1px 下划线 + 墨色加重（不用色块、不用 chip 底色，与账簿一致）。
- **默认 `最近在线` 倒序**：运维第一眼想知道「哪台还活着」，而不是字母序。
- **再点同一个键 = 反转方向**，箭头 `↑/↓` 跟在词后；换键时回到该键的自然方向。
- **记忆**：`localStorage['sui.nodeSort']`，刷新/换设备（同浏览器）后保持。
- **每行两行式**：上行节点名，下行 `内核版本 · 最近在线时长`（等宽小字，55% 不透明度）；左侧 6px 圆点表示 core 是否 running，未启用的节点整行降到 45%。

**手动顺序（同日补）**：三个键之外，行本身可以拖——拖一次即切到「自定义」（排序条里多出第 4 个键，仅在已有自定义顺序时出现）。
落点用 1px 墨线提示（inset box-shadow），不用色块或半透明填充；拖动中的行降到 40%。
键盘等价物：行获得焦点后 `Alt+↑/↓` 上下挪（拖拽对键盘用户不可用，必须给等价路径）。
顺序存 `localStorage['sui.nodeOrder']`（id 数组），新加的节点没排过时排在最后，不打断已有顺序。
