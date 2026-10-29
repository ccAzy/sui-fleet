/**
 * plugins/vuetify.ts
 *
 * 纸白极简主题：颜色与排版 token 在 styles/paper.css，这里只负责
 * 把同一套值交给 Vuetify（组件内部样式），并统一控件形态。
 *
 * 明暗由 localStorage 的 `theme` 决定：light | dark | system。
 */
import '@mdi/font/css/materialdesignicons.css'
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
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#2c4a6e',
          secondary: '#57564f',
          error: '#a63a2e',
          success: '#2f6b4f',
          warning: '#8a6a1f',
          info: '#2c4a6e',
          background: '#f6f5f1',
          surface: '#fffefb',
          'surface-variant': '#eeede8',
          'on-surface-variant': '#1a1a19',
          'on-surface': '#1a1a19',
          'on-background': '#1a1a19',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#8fb2da',
          secondary: '#a8a59c',
          error: '#dd7f72',
          success: '#86c2a1',
          warning: '#cfae64',
          info: '#8fb2da',
          background: '#121211',
          surface: '#191918',
          'surface-variant': '#101010',
          'on-surface-variant': '#e9e7e1',
          'on-surface': '#e9e7e1',
          'on-background': '#e9e7e1',
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
