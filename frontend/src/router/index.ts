// Composables
import { createRouter, createWebHistory } from 'vue-router'
import Login from '@/views/Login.vue'
import Data from '@/store/modules/data'

// 组件对照页（/devui）只在 `npm run dev` 时可访问。
//
// 开关用 vite.config.mts 注入的构建期常量 __DEV_UI__：
//   serve → true，注册路由
//   build → false，整个三元表达式静态折叠成 []，DevUi 那个 55 kB 的 chunk
//           和动态 import 一起被摇掉，不进生产产物（已验证）。
//
// 为什么不用 import.meta.env：实测 Vite 8 + Rolldown 在 dev 下没替换它，
// 连 import.meta.env.PROD 都被算成真值 —— 结果本地 /devui 不注册、还被
// 轮询的 401 挤到 /login。别在这条路上再试。
// 只靠构建期常量控制：`npm run build` 时 __DEV_UI__ 是 false，整段会被摇掉。
// 这里刻意不写域名黑名单 —— 那是把部署域名硬编进公开源码，没有实际防护价值
// （生产包根本不含这段），只会泄露信息。
const isLocalDev = __DEV_UI__

const routes = [
  ...(isLocalDev
    ? [
        {
          // 必须是单层路径：全局 API 用的是相对路径（`api/load`），
          // 在 `/dev/ui` 这种二级路径下会被解析成 `/dev/api/load`，
          // 打不中 vite proxy 的 /api 规则，退回 index.html，
          // 于是 `_respToMsg` 拿到 HTML 报 `unknown data: <!DOCTYPE html>`。
          path: '/devui',
          name: 'dev.ui',
          meta: { skipPoll: true },
          component: () => import('@/views/DevUi.vue'),
        },
      ]
    : []),
  {
    path: '/login',
    name: 'pages.login',
    component: Login,
  },
  {
    path: '/',
    component: () => import('@/layouts/default/Default.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '/',
        name: 'pages.home',
        component: () => import('@/views/Home.vue'),
      },
      {
        path: '/inbounds',
        name: 'pages.inbounds',
        component: () => import('@/views/Inbounds.vue'),
      },
      {
        path: '/relay',
        name: 'pages.relay',
        component: () => import('@/views/Relay.vue'),
      },
      {
        path: '/servers',
        name: 'pages.servers',
        component: () => import('@/views/Servers.vue'),
      },
      {
        path: '/clients',
        name: 'pages.clients',
        component: () => import('@/views/Clients.vue'),
      },  
      {
        path: '/outbounds',
        name: 'pages.outbounds',
        component: () => import('@/views/Outbounds.vue'),
      },
      {
        path: '/services',
        name: 'pages.services',
        component: () => import('@/views/Services.vue'),
      },
      {
        path: '/endpoints',
        name: 'pages.endpoints',
        component: () => import('@/views/Endpoints.vue'),
      },
      {
        path: '/rules',
        name: 'pages.rules',
        component: () => import('@/views/Rules.vue'),
      },
      {
        path: '/tls',
        name: 'pages.tls',
        component: () => import('@/views/Tls.vue'),
      },
      {
        path: '/basics',
        name: 'pages.basics',
        component: () => import('@/views/Basics.vue'),
      },
      {
        path: '/dns',
        name: 'pages.dns',
        component: () => import('@/views/Dns.vue'),
      },
      {
        path: '/admins',
        name: 'pages.admins',
        component: () => import('@/views/Admins.vue'),
      },
      {
        path: '/settings',
        name: 'pages.settings',
        component: () => import('@/views/Settings.vue'),
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory((window as any).BASE_URL),
  routes,
})

let intervalId:any

// Navigation guard to check authentication state
router.beforeEach((to) => {
  // Check the session cookie
  const sessionCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('s-ui='))
  const isAuthenticated = !!sessionCookie

  // If the route requires authentication and the user is not authenticated, redirect to /login
  if (to.meta.requiresAuth && !isAuthenticated) {
    return '/login'
  }
  if (to.path === '/login' && isAuthenticated) {
    // If already authenticated and visiting /login, redirect to '/'
    return '/'
  }

  // Load default data
  if (to.path !== '/login' && !to.meta.skipPoll) {
    loadDataInterval()
  } else {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = undefined
    }
  }
})

const loadDataInterval = () => {
  if (intervalId) return
  Data().loadData()
  intervalId = setInterval(() => {
    Data().loadData()
  }, 10000)
}

export default router
