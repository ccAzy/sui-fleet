<template>
  <v-app-bar :elevation="5">
    <v-icon v-if="isMobile" icon="mdi-menu" role="button" tabindex="0" aria-label="Menu" @click="$emit('toggleDrawer')" />
    <span v-else style="width: 24px"></span>
    <v-app-bar-title :text="$t(<string>route.name)" class="align-center top-title" />
    <v-menu v-if="servers.length > 0 || currentServer">
      <template v-slot:activator="{ props }">
        <v-btn v-bind="props" variant="text" size="small" class="me-1 server-switch"
          :class="{ 'server-switch--remote': !!currentServer }">
          <span class="server-dot" aria-hidden="true"></span>
          {{ currentServerName || $t('server.local') }}
        </v-btn>
      </template>
      <v-list density="compact" nav class="node-menu">
        <div class="node-sort" role="group" :aria-label="$t('server.sortBy')">
          <button
            v-for="k in sortKeys"
            :key="k.key"
            type="button"
            class="node-sort__btn"
            :class="{ 'is-on': sortBy.key === k.key }"
            :aria-pressed="sortBy.key === k.key"
            @click="setSort(k.key)"
          >
            {{ $t(k.label) }}<span v-if="sortBy.key === k.key" class="node-sort__dir" aria-hidden="true">{{ sortBy.dir === 1 ? '↑' : '↓' }}</span>
          </button>
        </div>
        <v-list-item @click="selectServer('')" :active="currentServer === ''">
          <template v-slot:prepend><v-icon icon="mdi-home"></v-icon></template>
          <v-list-item-title>{{ $t('server.local') }}</v-list-item-title>
        </v-list-item>
        <v-divider></v-divider>
        <v-list-item
          v-for="s in sortedServers"
          :key="s.id"
          @click="selectServer(String(s.id))"
          :active="currentServer === String(s.id)"
          :class="{ 'is-down': s.enabled === false }"
        >
          <template v-slot:prepend>
            <span class="node-dot" :class="{ 'is-on': s.core_state === 'running' }" aria-hidden="true"></span>
          </template>
          <v-list-item-title class="node-name">{{ s.name }}</v-list-item-title>
          <v-list-item-subtitle class="node-meta">
            {{ s.kernel_ver || '—' }}<span class="sep">·</span>{{ ago(s.last_seen) }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-menu>
    <v-menu>
      <template v-slot:activator="{ props }">
        <v-btn icon v-bind="props" :aria-label="$t('language') || 'Language'">
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
        <v-btn icon v-bind="props" aria-label="Theme">
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

// 节点排序：机器多了以后，下拉里按名字/最近在线/运行状态排一遍比顺序扫省事。
// 选择记在 localStorage，刷新后保持；同一个键再点一次反转方向。
type SortKey = 'name' | 'seen' | 'state'
const sortKeys: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'server.sortName' },
  { key: 'seen', label: 'server.sortSeen' },
  { key: 'state', label: 'server.sortState' },
]
const SORT_STORE = 'sui.nodeSort'
const readSort = (): { key: SortKey; dir: 1 | -1 } => {
  try {
    const [k, d] = String(localStorage.getItem(SORT_STORE) || '').split(':')
    if (sortKeys.some((x) => x.key === k)) return { key: k as SortKey, dir: d === '-1' ? -1 : 1 }
  } catch {
    /* localStorage 不可用时用默认 */
  }
  // 默认最近在线的排最前（seen 的自然方向是倒序）
  return { key: 'seen', dir: -1 }
}
const sortBy = ref(readSort())
const setSort = (key: SortKey) => {
  // 换键时用该键的自然方向：名称 A→Z、最近在线新→旧、状态运行中在前
  const naturalDir: 1 | -1 = key === 'seen' ? -1 : 1
  sortBy.value = sortBy.value.key === key
    ? { key, dir: (sortBy.value.dir === 1 ? -1 : 1) as 1 | -1 }
    : { key, dir: naturalDir }
  try {
    localStorage.setItem(SORT_STORE, `${sortBy.value.key}:${sortBy.value.dir}`)
  } catch {
    /* 忽略 */
  }
}
const ago = (ts?: number): string => {
  if (!ts) return '—'
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
const sortedServers = computed((): any[] => {
  const list = [...servers.value]
  const { key, dir } = sortBy.value
  const cmp = (a: any, b: any): number => {
    if (key === 'name') return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hans-CN')
    if (key === 'seen') return Number(a.last_seen ?? 0) - Number(b.last_seen ?? 0)
    // running 优先，未启用垫底（rank 小的在前面，配合 dir=1）
    const rank = (x: any) => (x.enabled === false ? 2 : x.core_state === 'running' ? 0 : 1)
    return rank(a) - rank(b)
  }
  list.sort((a, b) => cmp(a, b) * dir)
  return list
})
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
/* 页名左对齐：居中标题是模板的默认值，账簿上抬头永远在左边 */
.top-title :deep(.v-toolbar-title__placeholder) {
  font-size: var(--fs-xl);
  line-height: 1.2;
}

/* ---- 节点下拉：排序条 + 两行条目（账簿风：细规则线，不靠色块）---- */
.node-menu {
  min-width: 260px;
}
.node-sort {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  margin-bottom: 2px;
}
.node-sort__btn {
  flex: 1 1 0;
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 12px;
  letter-spacing: 0.02em;
  padding: 6px 4px 7px;
  border-bottom: 1px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.node-sort__btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.node-sort__btn.is-on {
  color: rgb(var(--v-theme-on-surface));
  border-bottom-color: rgb(var(--v-theme-primary, 33, 33, 33));
}
.node-sort__btn:focus-visible {
  outline: 1px dashed rgba(var(--v-theme-on-surface), 0.5);
  outline-offset: 2px;
}
.node-sort__dir {
  margin-left: 2px;
  font-size: 11px;
  opacity: 0.7;
}
.node-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-inline-end: 10px;
  background: rgba(var(--v-theme-on-surface), 0.25);
}
.node-dot.is-on {
  background: #2e7d32;
}
.node-name {
  font-size: 14px;
  line-height: 1.35;
}
.node-meta {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.02em;
  opacity: 0.55;
}
.node-meta .sep {
  margin: 0 5px;
}
.is-down .node-name,
.is-down .node-meta {
  opacity: 0.45;
}
</style>
