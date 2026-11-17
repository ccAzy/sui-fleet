/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Tailwind 必须最先加载：它的 @layer 语句用来定死全序
// （vuetify-core → vuetify-components → theme → utilities），
// 晚于 Vuetify 样式加载就排不进去。详见该文件顶部注释。
import '@/styles/tailwind.css'

// Composables
import { createApp, ref } from 'vue'

// Components
import App from './App.vue'

// Use router
import router from './router'

// Store
import store from './store'

// Plugins
import { registerPlugins } from '@/plugins'

// Paper world: 纸白极简（双主题）
import '@/styles/paper.css'
import '@/styles/components.css'
import '@/styles/wallpaper.css'
import { applyThemeMode, savedThemeMode } from '@/plugins/vuetify'
import { applyWp, initWallpaper, readWp } from '@/plugins/wallpaper'

// Locale
import { ensureLocale, i18n } from '@/locales'

// Notivue
import { createNotivue } from 'notivue'
import 'notivue/notification.css'
import 'notivue/animations.css'
const notivue = createNotivue({
  position: 'bottom-center',
  limit: 4,
  enqueue: false,
  avoidDuplicates: true,
  notifications: {
    global: {
      duration: 3000
    }
  },
})

const loading = ref(false)

// 在挂载前把明暗刷到 <html>，避免首帧闪烁
applyThemeMode(savedThemeMode())
// 壁纸同理：参数同步刷上，大图异步换（首帧不闪）
applyWp(readWp())
void initWallpaper()

const app = createApp(App)
app.provide('loading', loading)

// number 输入框被聚焦时，鼠标滚轮会静默改值——配置面板里有 90 个数字字段，
// 滚动页面时误改配置很难被发现。滚到 number 输入框上直接 blur 掉，
// 代价只是要改值前先点一下，收益是不会意外改坏配置。
document.addEventListener(
  'wheel',
  (e) => {
    const el = e.target as HTMLElement | null
    if (el instanceof HTMLInputElement && el.type === 'number') el.blur()
  },
  { passive: true },
)

await ensureLocale(i18n.global.locale.value as string)
registerPlugins(app)

app
  .use(router)
  .use(store)
  .use(i18n)
  .use(notivue)
  .mount('#app')
