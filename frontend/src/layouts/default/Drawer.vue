<template>
  <v-navigation-drawer
    v-model="showDrawer"
    :temporary="isMobile"
    :expand-on-hover="!isMobile"
    :rail="!isMobile"
    :permanent="!isMobile"
    @click="isMobile ? $emit('toggleDrawer') : null"
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
import { computed } from 'vue'
import router from '@/router'
import { logout } from '@/plugins/httputil'

const props = defineProps(['isMobile', 'displayDrawer'])

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
