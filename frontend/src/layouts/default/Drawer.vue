<template>
  <!--
    侧栏展开方式必须按「指针能力」而不是「屏幕宽度」判断：
    宽屏触屏设备（平板、触屏笔记本）走的是桌面分支，而 expand-on-hover 在
    触屏上没有 hover 可用 —— 菜单文字永远打不开。coarse 指针（手指）时改成点击展开。
  -->
  <v-navigation-drawer
    v-model="showDrawer"
    :temporary="isMobile"
    :expand-on-hover="!isMobile && !coarse"
    :rail="!isMobile && !railOpen"
    :permanent="!isMobile"
    @click="onDrawerClick"
  >
    <!-- 品牌区：rail 时只剩图标，展开时露出字 -->
    <div class="brand">
      <img src="@/assets/logo.svg" class="brand-mark" alt="S-UI" />
      <span class="brand-name">S-UI</span>
      <v-icon v-if="isMobile" icon="mdi-close" class="brand-close" @click="$emit('toggleDrawer')" />
    </div>

    <v-list density="compact" nav class="nav">
      <template v-for="group in groups" :key="group.title">
        <v-list-subheader class="nav-group">{{ $t(group.title) }}</v-list-subheader>
        <v-list-item
          link
          v-for="item in group.items"
          :key="item.title"
          :to="item.path"
          :active="router.currentRoute.value.path == item.path"
        >
          <template v-slot:prepend>
            <v-icon :icon="item.icon"></v-icon>
          </template>
          <v-list-item-title v-text="$t(item.title)"></v-list-item-title>
        </v-list-item>
      </template>

    </v-list>

    <template v-slot:append>
      <v-divider class="nav-divider"></v-divider>
      <v-list density="compact" nav class="nav-foot">
        <v-list-item @click="Logout">
          <template v-slot:prepend>
            <v-icon icon="mdi-logout-variant"></v-icon>
          </template>
          <v-list-item-title v-text="$t('menu.logout')"></v-list-item-title>
        </v-list-item>
      </v-list>
    </template>
  </v-navigation-drawer>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import router from '@/router'
import { logout } from '@/plugins/httputil'

const props = defineProps(['isMobile', 'displayDrawer'])
const emit = defineEmits(['toggleDrawer'])

/**
 * 触屏没有 hover：宽屏触屏设备上 expand-on-hover 等于菜单永远打不开。
 * 这里用 (pointer: coarse) 判断"主要输入是手指"，改成点击展开。
 */
const coarse = ref(false)
const railOpen = ref(false)
let mq: MediaQueryList | null = null
const onMq = (e: MediaQueryListEvent) => {
  coarse.value = e.matches
  if (!e.matches) railOpen.value = false
}
onMounted(() => {
  mq = window.matchMedia('(pointer: coarse)')
  coarse.value = mq.matches
  mq.addEventListener('change', onMq)
})
onUnmounted(() => mq?.removeEventListener('change', onMq))

const onDrawerClick = (e: MouseEvent) => {
  if (props.isMobile) {
    emit('toggleDrawer')
    return
  }
  if (!coarse.value) return
  // 点菜单项 → 收起；点侧栏空白 → 切换
  const el = e.target as HTMLElement | null
  railOpen.value = el?.closest?.('.v-list-item') ? false : !railOpen.value
}

const showDrawer = computed((): boolean => {
  return props.displayDrawer
})

// 按用途分组，而不是一长条平铺（14 项平铺等于没有信息结构）
const groups = [
  {
    title: 'menu.group.overview',
    items: [{ title: 'pages.home', icon: 'mdi-home-outline', path: '/' }],
  },
  {
    title: 'menu.group.nodes',
    items: [
      { title: 'pages.inbounds', icon: 'mdi-cloud-download-outline', path: '/inbounds' },
      { title: 'pages.relay', icon: 'mdi-transit-connection-variant', path: '/relay' },
      { title: 'pages.servers', icon: 'mdi-server-network-outline', path: '/servers' },
      { title: 'pages.clients', icon: 'mdi-account-multiple-outline', path: '/clients' },
    ],
  },
  {
    title: 'menu.group.egress',
    items: [
      { title: 'pages.outbounds', icon: 'mdi-cloud-upload-outline', path: '/outbounds' },
      { title: 'pages.endpoints', icon: 'mdi-lan-connect', path: '/endpoints' },
      { title: 'pages.services', icon: 'mdi-server-outline', path: '/services' },
      { title: 'pages.tls', icon: 'mdi-certificate-outline', path: '/tls' },
    ],
  },
  {
    title: 'menu.group.system',
    items: [
      { title: 'pages.basics', icon: 'mdi-application-cog-outline', path: '/basics' },
      { title: 'pages.rules', icon: 'mdi-routes', path: '/rules' },
      { title: 'pages.dns', icon: 'mdi-dns-outline', path: '/dns' },
      { title: 'pages.admins', icon: 'mdi-account-tie-outline', path: '/admins' },
      { title: 'pages.settings', icon: 'mdi-cog-outline', path: '/settings' },
    ],
  },
]

const Logout = async () => {
  logout()
}
</script>
