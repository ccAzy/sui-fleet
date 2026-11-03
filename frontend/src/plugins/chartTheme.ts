// 图表（Chart.js 画在 canvas 上）取不到 CSS 变量，颜色只能由 JS 传进去。
// 之前这里散落着写死的灰色，实测：
//   #8a8a8a 在浅色纸面 #f6f5f1 上只有 **3.16:1**（10px 轴标签，低于 AA 4.5）
//   #777777 只有 4.10:1；而 rgba(0,0,0,.06) 的网格线在深色主题下几乎不可见
// 所以统一走这里，值与 paper.css 的 --ink-3 / --rule 对齐：
//   浅色 --ink-3 #6b6961（5.04:1）  深色 --ink-3 #908d84（5.65:1）
export const chartInk = (dark: boolean): string => (dark ? "#908d84" : "#6b6961");

// 网格线：浅色用黑 6%，深色必须用白（黑在 #121211 上看不见）
export const chartGrid = (dark: boolean): string =>
  dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)";
