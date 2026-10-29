<template>
  <LogVue v-model="logModal.visible" :control="logModal" :visible="logModal.visible" />
  <Backup v-model="backupModal.visible" :control="backupModal" :visible="backupModal.visible" />
  <UsageStats v-model:visible="usageStatsModal.visible" />
  <v-container class="fill-height" :loading="loading">
    <v-responsive :class="reloadItems.length>0 ? 'fill-height text-center' : 'align-center'" >
      <v-row class="d-flex align-center justify-center">
        <v-col cols="auto">
          <v-img src="@/assets/logo.svg" :width="reloadItems.length>0 ? 88 : 132" class="home-mark"></v-img>
        </v-col>
      </v-row>
      <v-row class="d-flex align-center justify-center">
        <v-col cols="auto" class="quick-actions">
          <v-dialog v-model="menu" :close-on-content-click="false" transition="scale-transition" max-width="800">
            <template v-slot:activator="{ props }">
              <v-btn v-bind="props" variant="text" class="toolbar-ghost" prepend-icon="mdi-star-plus">{{ $t('main.tiles') }}</v-btn>
            </template>
            <v-card>
              <v-card-title>
                <v-row>
                  <v-col>
                    {{ $t('main.tiles') }}
                  </v-col>
                  <v-spacer></v-spacer>
                  <v-col cols="auto"><v-icon icon="mdi-close" @click="menu = false"></v-icon></v-col>
                </v-row>
              </v-card-title>
              <v-divider></v-divider>
              <v-row v-for="items in menuItems" density="compact">
                <v-col cols="12">
                  <v-card :subtitle="items.title" variant="flat">
                    <v-card-text>
                      <v-row density="compact">
                        <v-col cols="12" md="6" lg="3" v-for="item in items.value">
                          <v-switch
                          density="compact"
                          v-model="reloadItems"
                          :value="item.value"
                          color="primary"
                          :label="item.title"
                          hide-details></v-switch>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>
                </v-col>
              </v-row>
            </v-card>
          </v-dialog>
          <v-btn variant="text" class="toolbar-ghost" prepend-icon="mdi-backup-restore" @click="backupModal.visible = true">
            {{ $t('main.backup.title') }}
          </v-btn>
          <v-btn variant="text" class="toolbar-ghost" prepend-icon="mdi-list-box-outline" @click="logModal.visible = true">
            {{ $t('basic.log.title') }}
          </v-btn>
          <v-btn variant="text" class="toolbar-ghost" prepend-icon="mdi-chart-box-outline" @click="usageStatsModal.visible = true">
            {{ $t('main.stats.title') }}
          </v-btn>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" sm="6" md="3" v-for="i in reloadItems" :key="i">
          <v-card class="tile-card">
            <v-card-title>
              {{ menuItems.flatMap(cat => cat.value).find(m => m.value == i)?.title }}
              <template v-if="i == 'i-sys'">
                <v-icon icon="mdi-refresh" color="primary"
                  @click="reloadSys()" size="small"
                  style="margin-inline-start: 10px;">
                  <v-tooltip activator="parent" location="top">{{ $t('actions.refresh') }}</v-tooltip>
                </v-icon>
              </template>
              <template v-if="i == 'h-net'">
                <v-icon icon="mdi-information" color="primary" size="small"
                  style="margin-inline-start: 10px;">
                  <v-tooltip activator="parent" location="top">
                    ↓{{ HumanReadable.sizeFormat(tilesData.net?.recv) }} · ↑{{ HumanReadable.sizeFormat(tilesData.net?.sent) }}
                  </v-tooltip>
                </v-icon>
              </template>
            </v-card-title>
            <v-card-text style="padding: 0 16px;" align="center" justify="center">
              <Gauge :tilesData="tilesData" :type="i" v-if="i.charAt(0) == 'g'" />
              <History :tilesData="tilesData" :type="i" v-if="i.charAt(0) == 'h'" />
              <template v-if="i == 'i-sys'">
                <v-row>
                  <v-col cols="3">{{ $t('main.info.host') }}</v-col>
                  <v-col cols="9" style="text-wrap: nowrap; overflow: hidden">{{ tilesData.sys?.hostName }}</v-col>
                  <v-col cols="3">{{ $t('main.info.cpu') }}</v-col>
                  <v-col cols="9">
                    <v-chip density="compact" variant="flat">
                      <v-tooltip activator="parent" location="top" style="direction: ltr;">
                        {{ tilesData.sys?.cpuType }}
                      </v-tooltip>
                     {{ tilesData.sys?.cpuCount }} {{ $t('main.info.core') }}
                    </v-chip>
                  </v-col>
                  <v-col cols="3">IP</v-col>
                  <v-col cols="9">
                    <v-chip density="compact" variant="outlined" v-if="tilesData.sys?.ipv4?.length>0">
                      <v-tooltip activator="parent" location="top" style="direction: ltr;">
                        <span v-html="tilesData.sys?.ipv4?.join('<br />')"></span>
                      </v-tooltip>
                      IPv4
                    </v-chip>
                    <v-chip density="compact" variant="outlined" v-if="tilesData.sys?.ipv6?.length>0">
                      <v-tooltip activator="parent" location="top" style="direction: ltr;">
                        <span v-html="tilesData.sys?.ipv6?.join('<br />')"></span>
                      </v-tooltip>
                      IPv6
                    </v-chip>
                  </v-col>
                  <v-col cols="3">S-UI</v-col>
                  <v-col cols="9">
                    <v-chip density="compact" color="blue">
                      v{{ tilesData.sys?.appVersion }}
                    </v-chip>
                  </v-col>
                  <v-col cols="3">{{ $t('main.info.uptime') }}</v-col>
                  <v-col cols="9">
                    <v-tooltip activator="parent" location="top">
                      {{ $t('main.info.startupTime') }}: {{ new Date((tilesData.sys?.bootTime || 0) * 1000).toLocaleString(locale) }}
                    </v-tooltip>
                    {{ HumanReadable.formatSecond((Date.now()/1000) - tilesData.sys?.bootTime) }}
                  </v-col>
                </v-row>
              </template>
              <template v-if="i == 'i-sbd'">
                <v-row>
                  <v-col cols="4">{{ $t('main.info.running') }}</v-col>
                  <v-col cols="8">
                    <v-chip density="compact" color="success" variant="flat" v-if="tilesData.sbd?.running">{{ $t('yes') }}</v-chip> 
                    <v-chip density="compact" color="error" variant="flat" v-else>{{ $t('no') }}</v-chip>
                    <v-chip density="compact" color="transparent" v-if="tilesData.sbd?.running && !loading" style="cursor: pointer;" @click="restartSingbox()">
                      <v-tooltip activator="parent" location="top">
                        {{ $t('actions.restartSb') }}
                      </v-tooltip>
                      <v-icon icon="mdi-restart" color="warning" />
                    </v-chip>
                  </v-col>
                  <v-col cols="4">{{ $t('main.info.kernel') }}</v-col>
                  <v-col cols="8">
                    <span class="kernel-ver">{{ tilesData.kernel?.version || '-' }}</span>
                    <!-- 可更新只看"节点包版本 vs 面板配置的分发包版本"；
                         上游 sing-box 新 tag 只作为参考，不代表你手上有新包 -->
                    <v-chip
                      v-if="tilesData.agent?.outdated"
                      size="x-small"
                      color="warning"
                      variant="tonal"
                      class="ms-2 kernel-update"
                      :disabled="updating"
                      @click="updateAgent"
                    >
                      <v-icon icon="mdi-download" size="14" class="me-1" />
                      {{ tilesData.agent?.latest }}
                    </v-chip>
                    <span v-else-if="tilesData.kernel?.latest" class="kernel-latest">
                      {{ $t('main.info.upToDate') }}
                    </span>
                  </v-col>
                  <v-col cols="4">{{ $t('main.info.memory') }}</v-col>
                  <v-col cols="8">
                    <v-chip density="compact" variant="outlined" v-if="tilesData.sbd?.stats?.Alloc">
                      {{ HumanReadable.sizeFormat(tilesData.sbd?.stats?.Alloc) }}
                    </v-chip> 
                  </v-col>
                  <v-col cols="4">{{ $t('main.info.threads') }}</v-col>
                  <v-col cols="8">
                    <v-chip density="compact" variant="outlined" v-if="tilesData.sbd?.stats?.NumGoroutine">
                      {{ tilesData.sbd?.stats?.NumGoroutine }}
                    </v-chip>
                  </v-col>
                  <v-col cols="4">{{ $t('main.info.uptime') }}</v-col>
                  <v-col cols="8">{{ HumanReadable.formatSecond(tilesData.sbd?.stats?.Uptime) }}</v-col>
                  <v-col cols="4">{{ $t('online') }}</v-col>
                  <v-col cols="8">
                    <template v-if="tilesData.sbd?.running">
                      <v-chip density="compact" variant="outlined" v-if="Data().onlines.user">
                        <v-tooltip activator="parent" location="top" overflow="auto">
                          <span v-text="$t('pages.clients')" style="font-weight: bold;"></span><br/>
                          <span v-for="user in Data().onlines.user">{{ user }}<br /></span>
                        </v-tooltip>
                        {{ Data().onlines.user?.length }}
                      </v-chip>
                      <v-chip density="compact" color="success" variant="flat" v-if="Data().onlines.inbound">
                        <v-tooltip activator="parent" location="top" :text="$t('pages.inbounds')">
                          <span v-text="$t('pages.inbounds')" style="font-weight: bold;"></span><br/>
                          <span v-for="i in Data().onlines.inbound">{{ i }}<br /></span>
                        </v-tooltip>
                        {{ Data().onlines.inbound?.length }}
                      </v-chip>
                      <v-chip density="compact" color="info" variant="flat" v-if="Data().onlines.outbound">
                        <v-tooltip activator="parent" location="top" :text="$t('pages.outbounds')">
                          <span v-text="$t('pages.outbounds')" style="font-weight: bold;"></span><br/>
                          <span v-for="o in Data().onlines.outbound">{{ o }}<br /></span>
                        </v-tooltip>
                        {{ Data().onlines.outbound?.length }}
                      </v-chip>
                    </template>
                  </v-col>
                </v-row>
              </template>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>

<script lang="ts" setup>
import HttpUtils from '@/plugins/httputil'
import { HumanReadable } from '@/plugins/utils'
import Data from '@/store/modules/data'
import Gauge from '@/components/tiles/Gauge.vue'
import History from '@/components/tiles/History.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { i18n, locale } from '@/locales'
import LogVue from '@/layouts/modals/Logs.vue'
import Backup from '@/layouts/modals/Backup.vue'
import UsageStats from '@/layouts/modals/UsageStats.vue'

const loading = ref(false)
const menu = ref(false)
const menuItems = [
  { title: i18n.global.t('main.gauges'), value: [
    { title: i18n.global.t('main.gauge.cpu'), value: "g-cpu" },
    { title: i18n.global.t('main.gauge.mem'), value: "g-mem" },
    { title: i18n.global.t('main.gauge.dsk'), value: "g-dsk" },
    { title: i18n.global.t('main.gauge.swp'), value: "g-swp" },
    ]
  },
  { title: i18n.global.t('main.charts'), value: [
    { title: i18n.global.t('main.chart.cpu'), value: "h-cpu" },
    { title: i18n.global.t('main.chart.mem'), value: "h-mem" },
    { title: i18n.global.t('main.chart.net'), value: "h-net" },
    { title: i18n.global.t('main.chart.pnet'), value: "hp-net" },
    ]
  },
  { title: i18n.global.t('main.infos'), value: [
    { title: i18n.global.t('main.info.sys'), value: "i-sys" },
    { title: i18n.global.t('main.info.sbd'), value: "i-sbd" },
    ]
  },
]

const tilesData = ref(<any>{})

const reloadItems = computed({
  get() { return Data().reloadItems },
  set(v:string[]) {
    if (Data().reloadItems.length == 0 && v.length>0) startTimer()
    if (Data().reloadItems.length > 0 && v.length == 0) stopTimer()
    Data().reloadItems = v
    v.length>0 ? localStorage.setItem("reloadItems",v.join(',')) : localStorage.removeItem("reloadItems")
  }
})

const reloadData = async () => {
  const request = [...new Set(reloadItems.value.map(r => r.split('-')[1]))]
  if (tilesData.value?.sys?.appVersion) request.filter(r => r != 'sys')
  const data = await HttpUtils.get('api/status',{ r: request.join(',')})
  if (data.success) {
    tilesData.value = data.obj
  }
}

const reloadSys = async () => {
  const data = await HttpUtils.get('api/status',{ r: 'sys'})
  if (data.success) {
    tilesData.value.sys = data.obj.sys
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

const startTimer = () => {
  intervalId = setInterval(() => {
    reloadData()
  }, 2000)
}

const stopTimer = () => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

onMounted(async () => {
  loading.value = true
  if (Data().reloadItems.length != 0) {
    await reloadData()
    startTimer()
  }
  loading.value = false
})

onBeforeUnmount(() => {
  stopTimer()
})

const logModal = ref({ visible: false })

const backupModal = ref({ visible: false })

const usageStatsModal = ref({ visible: false })

const updating = ref(false)

// 下发"更新节点二进制"指令：节点自己下载校验替换，面板只记录
const updateAgent = async () => {
  updating.value = true
  await HttpUtils.post('api/updateAgent', {})
  updating.value = false
}

const restartSingbox = async () => {
  loading.value = true
  await HttpUtils.post('api/restartSb',{})
  loading.value = false
}
</script>

<style scoped>
/*
 * 监看卡片：账簿世界里的读数面板
 * - 标题是小号大写标签（数据才是主角）
 * - Gauge 用 padding-bottom:50% 撑半圆，所以高度必须容得下「标题 + 半圆」
 */
.tile-card {
  height: 196px;
}

.tile-card :deep(.v-card-title) {
  padding: 10px 14px 0;
  font-family: var(--sans);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-3);
  line-height: 1.35;
  min-height: 0;
  white-space: normal;
}

.tile-card :deep(.v-card-text) {
  padding: 4px 12px 10px !important;
}
</style>
