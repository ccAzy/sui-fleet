/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles/main.css'

import { fa, en, vi, zhHans, zhHant, ru } from 'vuetify/locale'

// Composables
import { createVuetify } from 'vuetify'
import { savedSkin } from './skins'

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  defaults: {
    VRow: { density: 'compact' },
    VTextField: {
      variant: 'solo-filled',
    },
    VSelect: {
      variant: 'solo-filled',
    },
    VCombobox: {
      variant: 'solo-filled',
    },
    VTextarea: {
      variant: 'solo-filled',
    },
  },
  theme: {
    defaultTheme: savedSkin().base,
    themes: {
      light: {
        colors: {
          primary: '#007AFF',
          error: '#FF3B30',
          success: '#34C759',
          warning: '#FF9F0A',
          info: '#32ADE6',
          background: '#F2F2F7',
          surface: '#FFFFFF',
        },
      },
      dark: {
        colors: {
          // Apple 系统色（深色模式变体），不是 Material 的深蓝
          primary: '#0A84FF',
          error: '#FF453A',
          success: '#30D158',
          warning: '#FFD60A',
          info: '#64D2FF',
          background: '#0B0B0D',
          surface: '#141418',
        },
      },
    },
  },
  locale: {
    locale: localStorage.getItem("locale") ?? 'en',
    fallback: 'en',
    messages: { en, fa, vi, zhHans, zhHant, ru },
  },
})
