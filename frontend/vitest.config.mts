import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 只跑纯逻辑测试：组件级测试需要完整 Vuetify 宿主，收益/成本比不划算。
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
