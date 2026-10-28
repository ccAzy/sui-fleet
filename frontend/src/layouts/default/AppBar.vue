<template>
  <v-app-bar :elevation="5">
    <v-icon v-if="isMobile" icon="mdi-menu" @click="$emit('toggleDrawer')" />
    <span v-else style="width: 24px"></span>
    <v-app-bar-title :text="$t(<string>route.name)" class="align-center text-center " />
    <v-menu v-if="servers.length > 0 || currentServer">
      <template v-slot:activator="{ props }">
        <v-btn v-bind="props" variant="text" size="small" class="me-1 server-switch"
          :class="{ 'server-switch--remote': !!currentServer }">
          <span class="server-dot" aria-hidden="true"></span>
          {{ currentServerName || $t('server.local') }}
        </v-btn>
      </template>
      <v-list density="compact" nav>
        <v-list-item @click="selectServer('')" :active="currentServer === ''">
          <template v-slot:prepend><v-icon icon="mdi-home"></v-icon></template>
          <v-list-item-title>{{ $t('server.local') }}</v-list-item-title>
        </v-list-item>
        <v-divider></v-divider>
        <v-list-item v-for="s in servers" :key="s.id" @click="selectServer(String(s.id))" :active="currentServer === String(s.id)">
          <template v-slot:prepend><v-icon icon="mdi-server"></v-icon></template>
          <v-list-item-title>{{ s.name }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
    <v-menu>
      <template v-slot:activator="{ props }">
        <v-btn icon v-bind="props">
          <v-icon>mdi-translate</v-icon>
        </v-btn>
      </template>
      <v-list>
        <v-list-item
          v-for="lang in languages"
          :key="lang.value"
          @click="changeLocale(lang.value)"
          :active="isActiveLocale(lang.value)"
        >
          <v-list-item-title>{{ lang.title }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
    <v-menu>
      <template v-slot:activator="{ props }">
        <v-btn icon v-bind="props">
          <v-icon>mdi-palette</v-icon>
        </v-btn>
      </template>
      <v-list density="compact">
        <v-list-item
          v-for="m in themeModes"
          :key="m.value"
          @click="changeTheme(m.value)"
          :active="themeMode === m.value"
        >
          <template v-slot:prepend>
            <v-icon size="16">{{ m.icon }}</v-icon>
          </template>
          <v-list-item-title>{{ $t(m.label) }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </v-app-bar>
</template>

<script lang="ts" setup>
import { useLocale, useTheme } from 'vuetify'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { languages } from '@/locales'
import Data from '@/store/modules/data'
import { applyThemeMode, savedThemeMode } from '@/plugins/vuetify'

defineProps(['isMobile'])

const servers = computed((): any[] => Data().servers ?? [])
const currentServer = computed((): string => Data().currentServer)
const currentServerName = computed((): string => {
  const id = Data().currentServer
  const list = Data().servers || []
  if (!id) {
    // 未指定节点时，后端 resolveNode() 会落到第一个启用节点。
    // cf 版面板没有「本机」这个概念（面板在 Cloudflare、内核在节点上），
    // 继续显示 s-ui 原版的 "Local" 会让人误以为在操作一台本地机器，
    // 因此这里直接显示实际会生效的节点名。
    return list[0]?.name ?? ''
  }
  const s = list.find((x: any) => String(x.id) === id)
  return s?.name ?? id
})
const selectServer = (id: string) => Data().setCurrentServer(id)

const route = useRoute()
const { locale: i18nLocale } = useI18n()
const vuetifyLocale = useLocale()
const theme = useTheme()

const changeLocale = (l: string) => {
  i18nLocale.value = l
  vuetifyLocale.current.value = l
  localStorage.setItem('locale', l)
  window.location.reload()
}
const isActiveLocale = (l: string) => i18nLocale.value === l
// 双主题：浅色（白天）/ 深色（夜间）/ 跟随系统。没有渐变皮肤了。
type ThemeMode = 'light' | 'dark' | 'system'
const themeModes: Array<{ value: ThemeMode; icon: string; label: string }> = [
  { value: 'light', icon: 'mdi-white-balance-sunny', label: 'theme.light' },
  { value: 'dark', icon: 'mdi-weather-night', label: 'theme.dark' },
  { value: 'system', icon: 'mdi-monitor', label: 'theme.system' },
]
const themeMode = ref<ThemeMode>(savedThemeMode())
const changeTheme = (m: ThemeMode) => {
  const base = applyThemeMode(m)
  theme.change(base)
  themeMode.value = m
}
</script>

<style scoped>
</style>
