<template>
  <LogVue v-model="logModal.visible" :control="logModal" :visible="logModal.visible" />
  <Backup v-model="backupModal.visible" :control="backupModal" :visible="backupModal.visible" />
  <UsageStats v-model:visible="usageStatsModal.visible" />
  <div>
    <div class="sheet">
      <!-- 页头：一台机器就是一条账目抬头，不再是居中 logo + 一排圆形仪表 -->
      <div class="sheet-head">
        <span class="ledger-mark" :data-state="running ? 'up' : 'error'" aria-hidden="true"></span>
        <span class="sheet-name">{{ nodeName }}</span>
        <span class="sheet-meta">{{ headMeta }}</span>
        <div class="sheet-actions">
          <v-dialog v-model="menu" :close-on-content-click="false" transition="scale-transition" max-width="760">
            <template v-slot:activator="{ props }">
              <v-btn v-bind="props" variant="text" size="small" class="toolbar-ghost" prepend-icon="mdi-star-plus">{{ $t('main.tiles') }}</v-btn>
            </template>
            <v-card>
              <v-card-title>{{ $t('main.tiles') }}</v-card-title>
              <v-divider></v-divider>
              <v-card-text>
                <div v-for="items in menuItems" :key="items.title" class="tiles-group">
                  <div class="metre-label">{{ items.title }}</div>
                  <div class="tiles-grid">
                    <v-switch
                      v-for="item in items.value"
                      :key="item.value"
                      density="compact"
                      v-model="reloadItems"
                      :value="item.value"
                      color="primary"
                      :label="item.title"
                      hide-details
                    ></v-switch>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </v-dialog>
          <v-btn variant="text" size="small" class="toolbar-ghost" prepend-icon="mdi-backup-restore" @click="backupModal.visible = true">
            {{ $t('main.backup.title') }}
          </v-btn>
          <v-btn variant="text" size="small" class="toolbar-ghost" prepend-icon="mdi-list-box-outline" @click="logModal.visible = true">
            {{ $t('basic.log.title') }}
          </v-btn>
          <v-btn variant="text" size="small" class="toolbar-ghost" prepend-icon="mdi-chart-box-outline" @click="usageStatsModal.visible = true">
            {{ $t('main.stats.title') }}
          </v-btn>
        </div>
      </div>

      <!-- 什么都没选：给出下一步，而不是一片空白 -->
      <div v-if="reloadItems.length === 0" class="sheet-empty">
        <span>{{ $t('main.emptyHint') }}</span>
        <v-btn variant="outlined" size="small" prepend-icon="mdi-star-plus" @click="menu = true">{{ $t('main.tiles') }}</v-btn>
      </div>

      <template v-else>
        <!-- 读数：四个数，一把尺 -->
        <div v-if="gauges.length" class="metres">
          <Gauge v-for="i in gauges" :key="i" :tilesData="tilesData" :type="i" />
        </div>

        <!-- 曲线：细线、无卡片、无图例框；带宽独占一行 -->
        <div v-if="charts.length" class="sparks">
          <div v-for="i in charts" :key="i" class="spark" :class="{ 'is-wide': i === 'h-net' || i === 'hp-net' }">
            <div class="spark-title">
              {{ title(i) }}
              <span v-if="i === 'h-net'" class="spark-legend">↓ {{ HumanReadable.sizeFormat(tilesData.net?.recv) }} · ↑ {{ HumanReadable.sizeFormat(tilesData.net?.sent) }}</span>
              <v-icon v-if="i === 'h-net'" icon="mdi-refresh" size="12" class="spark-refresh" @click="reloadSys()"></v-icon>
            </div>
            <div class="spark-body"><History :tilesData="tilesData" :type="i" /></div>
          </div>
        </div>

        <!-- 对账：左边系统，右边内核 -->
        <div v-if="infos.length" class="sheet-rows">
          <section v-if="infos.includes('i-sys')" class="sheet-block">
            <h3>{{ $t('main.info.sys') }}</h3>
            <div class="row-line"><span class="k">{{ $t('main.info.host') }}</span><span class="v is-text">{{ tilesData.sys?.hostName || '-' }}</span></div>
            <div class="row-line">
              <span class="k">{{ $t('main.info.cpu') }}</span>
              <span class="v" :title="tilesData.sys?.cpuType">{{ tilesData.sys?.cpuCount || '-' }} {{ $t('main.info.core') }}</span>
            </div>
            <div class="row-line"><span class="k">IP</span><span class="v" :title="[...(tilesData.sys?.ipv4 || []), ...(tilesData.sys?.ipv6 || [])].join('  ')">{{ sysIp }}</span></div>
            <div class="row-line"><span class="k">S-UI</span><span class="v">v{{ tilesData.sys?.appVersion || '-' }}</span></div>
            <div class="row-line">
              <span class="k">{{ $t('main.info.uptime') }}</span>
              <span class="v" :title="new Date((tilesData.sys?.bootTime || 0) * 1000).toLocaleString(locale)">{{ HumanReadable.formatSecond(Date.now() / 1000 - tilesData.sys?.bootTime) }}</span>
            </div>
          </section>

          <section v-if="infos.includes('i-sbd')" class="sheet-block">
            <h3>{{ $t('main.info.sbd') }}</h3>
            <div class="row-line">
              <span class="k">{{ $t('main.info.running') }}</span>
              <span class="v">
                <span :data-state="tilesData.sbd?.running ? 'up' : 'error'" class="state-text">{{ tilesData.sbd?.running ? $t('yes') : $t('no') }}</span>
                <v-icon v-if="tilesData.sbd?.running && !loading" icon="mdi-restart" size="14" class="ms-2 state-action" @click="restartSingbox()">
                  <v-tooltip activator="parent" location="top">{{ $t('actions.restartSb') }}</v-tooltip>
                </v-icon>
              </span>
            </div>
            <div class="row-line">
              <span class="k">{{ $t('main.info.kernel') }}</span>
              <span class="v">
                {{ tilesData.kernel?.version || '-' }}
                <v-icon v-if="tilesData.agent?.outdated" icon="mdi-download" size="14" class="ms-2 state-action" :class="{ 'is-busy': updating }" @click="updateAgent">
                  <v-tooltip activator="parent" location="top">{{ tilesData.agent?.latest }}</v-tooltip>
                </v-icon>
              </span>
            </div>
            <div class="row-line"><span class="k">{{ $t('main.info.memory') }}</span><span class="v">{{ tilesData.sbd?.stats?.Alloc ? HumanReadable.sizeFormat(tilesData.sbd.stats.Alloc) : '-' }}</span></div>
            <div class="row-line"><span class="k">{{ $t('main.info.threads') }}</span><span class="v">{{ tilesData.sbd?.stats?.NumGoroutine || '-' }}</span></div>
            <div class="row-line"><span class="k">{{ $t('main.info.uptime') }}</span><span class="v">{{ HumanReadable.formatSecond(tilesData.sbd?.stats?.Uptime) }}</span></div>
            <div class="row-line">
              <span class="k">{{ $t('online') }}</span>
              <span class="v">
                <template v-if="tilesData.sbd?.running">
                  <a class="online-num" @click="$router.push('/clients')">
                    <v-tooltip activator="parent" location="top" overflow="auto">
                      <span style="font-weight: bold;">{{ $t('pages.clients') }}</span>
                      <template v-if="Data().onlines.user?.length"><br /><span v-for="u in Data().onlines.user" :key="u">{{ u }}<br /></span></template>
                      <template v-else><br />{{ $t('main.info.noOnline') }}</template>
                    </v-tooltip>
                    {{ Data().onlines.user?.length || 0 }}
                  </a>
                  <span class="sep">·</span>
                  <a class="online-num" @click="$router.push('/inbounds')">
                    <v-tooltip activator="parent" location="top" overflow="auto">
                      <span style="font-weight: bold;">{{ $t('pages.inbounds') }}</span>
                      <template v-if="Data().onlines.inbound?.length"><br /><span v-for="t in Data().onlines.inbound" :key="t">{{ t }}<br /></span></template>
                      <template v-else><br />{{ $t('main.info.noOnline') }}</template>
                    </v-tooltip>
                    {{ Data().onlines.inbound?.length || 0 }}
                  </a>
                  <span class="sep">·</span>
                  <a class="online-num" @click="$router.push('/outbounds')">
                    <v-tooltip activator="parent" location="top" overflow="auto">
                      <span style="font-weight: bold;">{{ $t('pages.outbounds') }}</span>
                      <template v-if="Data().onlines.outbound?.length"><br /><span v-for="o in Data().onlines.outbound" :key="o">{{ o }}<br /></span></template>
                      <template v-else><br />{{ $t('main.info.noOnline') }}</template>
                    </v-tooltip>
                    {{ Data().onlines.outbound?.length || 0 }}
                  </a>
                </template>
                <span v-else>-</span>
              </span>
            </div>
          </section>
        </div>

        <!-- 历史：近 7 天流量（按天聚合）+ 谁在吃流量 + 需要处理的客户端 -->
        <TrafficTrend ref="trend" />
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import HttpUtils from '@/plugins/httputil'
import { HumanReadable } from '@/plugins/utils'
import Data from '@/store/modules/data'
import Gauge from '@/components/tiles/Gauge.vue'
import History from '@/components/tiles/History.vue'
import TrafficTrend from '@/components/tiles/TrafficTrend.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { i18n, locale } from '@/locales'
import LogVue from '@/layouts/modals/Logs.vue'
import Backup from '@/layouts/modals/Backup.vue'
import UsageStats from '@/layouts/modals/UsageStats.vue'

const loading = ref(false)
const trend = ref<InstanceType<typeof TrafficTrend> | null>(null)
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

// 按用户选择把读数分三组，顺序跟着选择走
const pick = (prefixes: string) => reloadItems.value.filter((i: string) => prefixes.includes(i.charAt(0)))
const gauges = computed(() => pick('g'))
const charts = computed(() => pick('h'))
const infos = computed(() => pick('i'))

const title = (v: string) => menuItems.flatMap(c => c.value).find(m => m.value === v)?.title ?? v

// 抬头显示的是「实际会被操作的机器」：未选节点时后端会落到第一台
const nodeName = computed(() => {
  const list = Data().servers || []
  const id = Data().currentServer
  if (!id) return list[0]?.name ?? 'Local'
  return list.find((x: any) => String(x.id) === id)?.name ?? id
})
const running = computed(() => !!tilesData.value.sbd?.running)
const headMeta = computed(() => {
  const bits: string[] = []
  if (tilesData.value.kernel?.version) bits.push('sing-box ' + tilesData.value.kernel.version)
  if (tilesData.value.sys?.bootTime) bits.push('up ' + HumanReadable.formatSecond(Date.now() / 1000 - tilesData.value.sys.bootTime))
  if (tilesData.value.agent?.outdated) bits.push('update ' + tilesData.value.agent.latest)
  return bits.join(' · ')
})
const sysIp = computed(() => {
  const v4 = tilesData.value.sys?.ipv4 || []
  const v6 = tilesData.value.sys?.ipv6 || []
  if (v4.length) return v4[0]
  if (v6.length) return v6[0]
  return '-'
})

const reloadData = async () => {
  const request = [...new Set(reloadItems.value.map((r: string) => r.split('-')[1]))]
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
  // 首页读数 10 秒刷新一次：Workers 免费版每天只有 10 万次请求，
  // 这个轮询是最大的单个消耗项（5 秒 = 1.7 万次/天/标签页），10 秒直接减半。
  intervalId = setInterval(() => {
    reloadData()
  }, 10000)
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
.sheet-empty {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: var(--s6) 0;
  color: var(--ink-3);
  font-size: var(--fs-sm);
}

.sheet-head .ledger-mark {
  align-self: center;
}

.state-text[data-state='up'] {
  color: var(--ok);
}

.state-text[data-state='error'] {
  color: var(--error);
}

.state-action {
  cursor: pointer;
  color: var(--ink-3);
  vertical-align: -2px;
}

.state-action:hover {
  color: var(--accent);
}

.state-action.is-busy {
  opacity: 0.4;
  pointer-events: none;
}

.online-num {
  color: var(--accent);
  cursor: pointer;
  text-decoration: none;
}

.spark-refresh {
  color: var(--ink-3);
  cursor: pointer;
  margin-left: var(--s2);
}

.tiles-group + .tiles-group {
  margin-top: var(--s4);
}

.tiles-group .metre-label {
  margin-bottom: var(--s2);
}

.tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0 var(--s4);
}
</style>
