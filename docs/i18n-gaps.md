# i18n 缺口（自动统计，勿手改）

由 `cd frontend && npm run i18n:missing` 生成。缺的键在运行时回落到英文
（`src/locales/index.ts` 里 `fallbackLocale: 'en'`），所以界面不会露出原始 key；
但对这些语言的用户来说仍显示英文。

| 语种 | 键数 | 缺失 | 覆盖率 |
| --- | --- | --- | --- |
| en（基准） | 740 | 0 | 100% |
| zh-Hans（zhcn） | 740 | 0 | 100% |
| zh-Hant（zhtw） | 740 | 0 | 100% |
| fa（波斯语） | 740 | 0 | 100% |
| vi（越南语） | 740 | 0 | 100% |
| ru（俄语） | 741 | 0 | 100% |

2026-11-02 补齐：fa / vi / ru 各补 207 个键（quickTemplate.*、relay.*、exportLinks.*、
server.*、actions.*、login.*、setting.security.*、setting.wallpaper.* 等），
zh-Hant 同时补齐 207 个键（由 zh-CN 经 OpenCC s2twp 转换）。

补的是**机器翻译初稿**，用法正确但措辞可能生硬；建议母语使用者抽查后再上线营销页面。
补的时候只改对应 locale 文件，不要动 `en.ts`（它是基准）。

加了新文案后跑 `npm run i18n:missing` 看是否又出现缺口。
