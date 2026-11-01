// node-cron 没有自带类型声明，而它只在自托管运行时用到（Worker 版本走 scheduled 事件）。
// 这里给一个最小声明，避免为了一个 import 再拉一份 @types 依赖。
declare module "node-cron" {
  const cron: {
    schedule(expr: string, fn: () => void): unknown;
  };
  export default cron;
}
