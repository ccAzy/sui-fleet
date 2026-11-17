/// <reference types="vite/client" />

declare module 'moment/locale/ru'
declare module 'moment/locale/vi'
declare module 'moment/locale/zh-cn'
declare module 'moment/locale/zh-tw'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/**
 * 构建期常量，由 vite.config.mts 的 define 注入。
 * serve 为 true，build 为 false —— 只有 serve 时才注册组件对照页路由。
 */
declare const __DEV_UI__: boolean
