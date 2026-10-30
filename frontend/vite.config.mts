// Plugins
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '',
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
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
  define: { 'process.env': {} },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  },
  server: {
    port: 3000,
    proxy: {
      '/app/api': {
        target: 'http://localhost:2095',
        changeOrigin: true,
      },
    },
  }
})
