// Plugins
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import tailwindcss from '@tailwindcss/vite'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ command }) => ({
  base: '',
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
    // Tailwind 4 作为 Vite 插件（不再需要 postcss 配置）；
    // 与 Vuetify 的共存规则见 src/styles/tailwind.css 顶部注释
    tailwindcss(),
    vuetify({
      autoImport: true,
      styles: {
        configFile: 'src/styles/settings.scss',
      },
    })
  ],
  build: {
    manifest: false,
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    // Vite 8 用 Rolldown：rollupOptions 已更名 rolldownOptions。
    // codeSplitting 必须开（上游 s-ui 原本关掉打单包 1.9MB）：
    // 关掉后 chart.js / 各路由页面全进首屏，开掉后只有首页需要的才首屏下载。
    // 文件名用内容哈希 [hash]（原来是随机 8 字节，每次构建都变，缓存彻底失效）。
    rolldownOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const hashed = assetInfo.names.some(name => name.endsWith('.css'))
            ? 'assets/[name]-[hash].css'
            : 'assets/[name]-[hash][extname]'
          return hashed
        },
      },
    },
  },
  define: {
    'process.env': {},
    // 开发/生产要用一个**可靠**的开关，不能用 import.meta.env：
    // 实测 Vite 8 + Rolldown 在 dev 下根本没替换 import.meta.env.DEV，
    // 连 import.meta.env.PROD 都算成真值（导致本地 /devui 直接不注册、
    // 被挤到 /login）。改成构建期常量：
    //   serve → true（本地能用组件对照页）
    //   build → false（整个分支静态折叠，DevUi 那个 55 kB chunk 不产物）
    __DEV_UI__: command === 'serve',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  },
  server: {
    port: 3000,
    // 后端路由是 /api/*（见 panel/src/index.ts：app.post("/api/login") ...），
    // 前端请求写的是相对路径 api/status → 浏览器解析为 /api/status。
    // 原来这里配的是 '/app/api' → 2095：
    //   · 路径对不上（/app/api 前缀永远不会命中 /api/*）
    //   · 2095 是上游 s-ui 的后端端口，本项目自托管是 8788、wrangler dev 是 8787
    // 结果就是本地 dev 时 API 全部落到 vite 自己身上，登录都进不去。
    // 想接 wrangler dev：VITE_API_TARGET=http://127.0.0.1:8787 npm run dev
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  }
}))
