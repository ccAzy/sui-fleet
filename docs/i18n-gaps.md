# i18n 缺口（自动统计，勿手改）

由 `cd frontend && npm run i18n:missing` 生成。缺的键在运行时回落到英文
（`src/locales/index.ts` 里 `fallbackLocale: 'en'`），所以界面不会露出原始 key；
但对这些语言的用户来说仍显示英文。

| 语种 | 键数 | 缺失 | 覆盖率 |
| --- | --- | --- | --- |
| en（基准） | 740 | 0 | 100% |
| zh-Hans（zhcn） | 740 | 0 | 100% |
| zh-Hant（zhtw） | 740 | 0 | 100% |
| fa（波斯语） | 533 | 207 | 72% |
| vi（越南语） | 533 | 207 | 72% |
| ru（俄语） | 534 | 207 | 72% |

缺失的 207 个键集中在本轮新增的 `default.quickTemplate.*`、`default.audit.*`
等条目（见 `npm run i18n:missing` 的前几行示例）。

补齐属于翻译工作，不是代码缺陷：结构、回落、Key 对齐都是对的。
补的时候只改对应 locale 文件，不要动 `en.ts`（它是基准）。
