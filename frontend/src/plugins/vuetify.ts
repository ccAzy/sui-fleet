/**
 * plugins/vuetify.ts
 *
 * 纸白极简主题：颜色与排版 token 在 styles/paper.css，这里只负责
 * 把同一套值交给 Vuetify（组件内部样式），并统一控件形态。
 *
 * 明暗由 localStorage 的 `theme` 决定：light | dark | system。
 */
// 图标：只打包用到的 122 个 MDI 图标（node scripts/subset-mdi.mjs 生成），
// 全量 @mdi/font 是 7492 类 + 4 种字体格式 3.6MB，国内首屏不划算。
import '@/styles/mdi-subset.css'
import 'vuetify/styles/main.css'

import { fa, en, vi, zhHans, zhHant, ru } from 'vuetify/locale'
import { createVuetify } from 'vuetify'

/** 用户偏好；system 跟随操作系统。 */
export function savedThemeMode(): 'light' | 'dark' | 'system' {
  const v = localStorage.getItem('theme')
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function resolvedTheme(): 'light' | 'dark' {
  const mode = savedThemeMode()
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyThemeMode(mode: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  localStorage.setItem('theme', mode)
  const base = mode === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode
  document.documentElement.setAttribute('data-theme', base)
  return base
}

export default createVuetify({
  defaults: {
    VRow: { density: 'compact' },
    // 纸质表单：1px 描边、无填充（填充色块是上一版的 AI 味来源之一）
    VTextField: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VCombobox: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    // 纸面上按钮要有实体感：描边是默认，主操作用 flat + primary 单独覆盖
    VBtn: { variant: 'outlined', density: 'comfortable', rounded: 0 },
    VCard: { rounded: 0, flat: true },
    VChip: { rounded: 0, size: 'x-small' },
    VList: { density: 'compact' },
    VSwitch: { density: 'compact', hideDetails: 'auto', color: 'primary' },
    VCheckbox: { density: 'compact', hideDetails: 'auto', color: 'primary' },
  },
  theme: {
    defaultTheme: resolvedTheme(),
    // 与 paper.css 的 Obsidian 双主题对齐：Vuetify 自己的主题色也必须换，
    // 否则开关、分页、内置按钮还是旧配色（深色下会出现亮蓝开关＋紫主题打架）。
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#6d5ce0',
          secondary: '#55555f',
          error: '#d92d5c',
          success: '#0f9d58',
          warning: '#b45309',
          info: '#6d5ce0',
          background: '#f5f5f9',
          surface: '#ffffff',
          'surface-variant': '#eeeef4',
          'on-surface-variant': '#14141a',
          'on-surface': '#14141a',
          'on-background': '#14141a',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#8b7bff',
          secondary: '#b6b6c2',
          error: '#fb7185',
          success: '#34d399',
          warning: '#fbbf24',
          info: '#8b7bff',
          background: '#070708',
          surface: '#0e0e12',
          'surface-variant': '#16161c',
          'on-surface-variant': '#f0f0f4',
          'on-surface': '#f0f0f4',
          'on-background': '#f0f0f4',
        },
      },
    },
  },
  locale: {
    locale: localStorage.getItem('locale') ?? 'en',
    fallback: 'en',
    messages: { en, fa, vi, zhHans, zhHant, ru },
  },
})
