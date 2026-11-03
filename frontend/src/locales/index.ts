import { createI18n } from 'vue-i18n'
import en from './en'

// 为什么只静态打包 en：
// 6 个语言文件合计约 220 KB，全部塞进入口包会白白拖慢首屏（用户只用一种语言）。
// 其余语言改成按需 import，切换时再下载；en 作为 fallback 必须同步可用。
const loaders = {
  en: () => Promise.resolve({ default: en }),
  fa: () => import('./fa'),
  vi: () => import('./vi'),
  zhHans: () => import('./zhcn'),
  zhHant: () => import('./zhtw'),
  ru: () => import('./ru'),
} as const

export type LocaleName = keyof typeof loaders

const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('locale')) || 'en'

export const i18n = createI18n({
  legacy: false,
  // 语言名是多值的（en/fa/vi/zhHans/zhHant/ru），这里显式放宽成 string：
  // 否则 createI18n 会把 locale 的类型收窄成字面量 'en'，各处比较会报 TS2678。
  locale: stored as string,
  fallbackLocale: 'en',
  messages: { en } as any,
})

/** 确保某个语言的词条已就位（已存在则直接返回）。 */
export async function ensureLocale(l: string): Promise<void> {
  if (!l || l === 'en') return
  if (i18n.global.availableLocales.includes(l)) return
  const load = loaders[l as LocaleName]
  if (!load) return
  const mod: any = await load()
  i18n.global.setLocaleMessage(l, mod?.default ?? mod)
}

/** 切换语言：先加载词条再切，避免出现一瞬间的 key 名。 */
export async function setLocale(l: string): Promise<void> {
  await ensureLocale(l)
  i18n.global.locale.value = l as any
  try {
    localStorage.setItem('locale', l)
  } catch {
    /* 隐私模式下 localStorage 可能抛错，不影响本次切换 */
  }
}

export const locale = (() => {
  const l = i18n.global.locale.value
  switch (l) {
    case "zhHans":
      return "zh-cn"
    case "zhHant":
      return "zh-tw"
    default:
      return l
  }
})()

export const languages = [
  { title: 'English', value: 'en' },
  { title: 'فارسی', value: 'fa' },
  { title: 'Tiếng Việt', value: 'vi' },
  { title: '简体中文', value: 'zhHans' },
  { title: '繁體中文', value: 'zhHant' },
  { title: 'Русский', value: 'ru' },
]
