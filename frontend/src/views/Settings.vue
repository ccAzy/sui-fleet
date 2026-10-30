<template>
  <v-card :loading="loading">
    <v-tabs
    v-model="tab"
    color="primary"
    align-tabs="center"
    show-arrows
  >
    <v-tab value="t1">{{ $t('setting.interface') }}</v-tab>
    <v-tab value="t2">{{ $t('setting.sub') }}</v-tab>
    <v-tab value="t3">{{ $t('setting.jsonSub') }}</v-tab>
    <v-tab value="t4">{{ $t('setting.clashSub') }}</v-tab>
    <v-tab value="t5">{{ $t('setting.wallpaper.title') }}</v-tab>
  </v-tabs>
  <v-card-text>
    <v-row align="center" justify="center" style="margin-bottom: 10px;">
      <v-col cols="auto">
        <v-btn color="primary" @click="save" :loading="loading" :disabled="!stateChange">
          {{ $t('actions.save') }}
        </v-btn>
      </v-col>
      <v-col cols="auto">
        <v-btn variant="text" class="toolbar-ghost" @click="restartApp" :loading="loading" :disabled="stateChange || updateRunning">
          {{ $t('actions.restartApp') }}
        </v-btn>
      </v-col>
      <v-col cols="auto" v-if="updateInfo?.updateAvailable || updateRunning">
        <!-- 点过一次就锁住:更新要跑一两分钟,期间再点会再起一份安装脚本 -->
        <v-btn variant="outlined" color="success" @click="updatePanel" :loading="updating" :disabled="stateChange || updateRunning">
          <template v-if="updateRunning">
            <v-progress-circular indeterminate size="16" width="2" class="me-2"></v-progress-circular>{{ $t('actions.updating') }}
          </template>
          <template v-else>{{ $t('actions.updatePanel') }} {{ updateInfo.latestVersion }}</template>
        </v-btn>
      </v-col>
    </v-row>
    <v-row v-if="updateRunning || updateFailed" justify="center" style="margin-top: -6px; margin-bottom: 8px;">
      <v-col cols="12" md="8">
        <v-alert :type="updateFailed ? 'warning' : 'info'" density="compact" variant="tonal" style="font-size: 0.85rem;">
          {{ updateFailed ? $t('actions.updateSlow') : $t('actions.updateWaiting', { v: updateTarget }) }}
        </v-alert>
      </v-col>
    </v-row>
    <v-window v-model="tab">
      <v-window-item value="t1">
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.webListen" :label="$t('setting.addr')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model.number="webPort" min="1" type="number" :label="$t('setting.port')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.webPath" :label="$t('setting.webPath')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.webDomain" :label="$t('setting.domain')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.webKeyFile" :label="$t('setting.sslKey')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.webCertFile" :label="$t('setting.sslCert')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.webURI" :label="$t('setting.webUri')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field
              type="number"
              v-model.number="sessionMaxAge"
              min="0"
              :label="$t('setting.sessionAge')"
              :suffix="$t('date.m')"
              hide-details
              ></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field
              type="number"
              v-model.number="trafficAge"
              min="0"
              :label="$t('setting.trafficAge')"
              :suffix="$t('date.d')"
              hide-details
              ></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.timeLocation" :label="$t('setting.timeLoc')" hide-details></v-text-field>
          </v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="t2">
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-switch color="primary" v-model="subEncode" :label="$t('setting.subEncode')" hide-details />
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-switch color="primary" v-model="subShowInfo" :label="$t('setting.subInfo')" hide-details />
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.subListen" :label="$t('setting.addr')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field
              type="number"
              v-model.number="subPort"
              min="1"
              :label="$t('setting.port')"
              hide-details></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.subKeyFile" :label="$t('setting.sslKey')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.subCertFile" :label="$t('setting.sslCert')" hide-details></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.subDomain" :label="$t('setting.domain')" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.subPath" :label="$t('setting.path')" hide-details></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-text-field
              type="number"
              v-model.number="subUpdates"
              min="0"
              :label="$t('setting.update')"
              hide-details
              ></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field v-model="settings.subURI" :label="$t('setting.subUri')" hide-details></v-text-field>
          </v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="t3">
        <SubJsonExtVue :settings="settings" />
      </v-window-item>

      <v-window-item value="t4">
        <SubClashExtVue :settings="settings" />
      </v-window-item>

      <!-- 外观：壁纸只铺「桌面」，不铺「纸」。所有控件即时生效，不需要点保存 -->
      <v-window-item value="t5">
        <div class="wp">
          <div class="wp-line">
            <div class="wp-key">
              {{ $t('setting.wallpaper.enable') }}
              <span class="wp-note">{{ $t('setting.wallpaper.hint') }}</span>
            </div>
            <button
              type="button"
              role="switch"
              class="wp-switch"
              :aria-checked="wp.on"
              :aria-label="$t('setting.wallpaper.enable')"
              @click="wp.on = !wp.on"
            ><span class="wp-switch-knob"></span></button>
          </div>

          <div class="wp-line">
            <div class="wp-key">{{ $t('setting.wallpaper.source') }}</div>
            <div class="wp-ctrl">
              <v-text-field
                v-model="urlInput"
                density="compact"
                hide-details
                single-line
                class="wp-url"
                :placeholder="$t('setting.wallpaper.urlPlaceholder')"
                @keyup.enter="useUrl"
              ></v-text-field>
              <v-btn size="small" variant="outlined" :loading="wpBusy" @click="useUrl">{{ $t('setting.wallpaper.useUrl') }}</v-btn>
              <v-btn size="small" variant="outlined" :loading="wpBusy" @click="fileInput?.click()">{{ $t('setting.wallpaper.upload') }}</v-btn>
              <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">
              {{ $t('setting.wallpaper.builtin') }}
              <span class="wp-note">{{ $t('setting.wallpaper.localOnly') }}</span>
            </div>
            <div class="wp-ctrl">
              <v-btn-toggle v-model="wp.builtin" density="compact" mandatory variant="outlined" divided>
                <v-btn value="none" size="small">{{ $t('setting.wallpaper.builtinNone') }}</v-btn>
                <v-btn value="fiber" size="small">{{ $t('setting.wallpaper.builtinFiber') }}</v-btn>
                <v-btn value="grid" size="small">{{ $t('setting.wallpaper.builtinGrid') }}</v-btn>
                <v-btn value="dots" size="small">{{ $t('setting.wallpaper.builtinDots') }}</v-btn>
              </v-btn-toggle>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">{{ $t('setting.wallpaper.blur') }}</div>
            <div class="wp-ctrl wp-ctrl--slider">
              <v-slider v-model="wp.blur" :min="0" :max="40" :step="1" thumb-label hide-details density="compact" :aria-label="$t('setting.wallpaper.blur')"></v-slider>
              <span class="wp-val mono">{{ wp.blur }}px</span>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">{{ $t('setting.wallpaper.contrast') }}</div>
            <div class="wp-ctrl wp-ctrl--slider">
              <v-slider v-model="wp.contrast" :min="80" :max="140" :step="1" thumb-label hide-details density="compact" :aria-label="$t('setting.wallpaper.contrast')"></v-slider>
              <span class="wp-val mono">{{ wp.contrast }}%</span>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">{{ $t('setting.wallpaper.saturate') }}</div>
            <div class="wp-ctrl wp-ctrl--slider">
              <v-slider v-model="wp.saturate" :min="0" :max="160" :step="1" thumb-label hide-details density="compact" :aria-label="$t('setting.wallpaper.saturate')"></v-slider>
              <span class="wp-val mono">{{ wp.saturate }}%</span>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">{{ $t('setting.wallpaper.veil') }}</div>
            <div class="wp-ctrl wp-ctrl--slider">
              <v-slider v-model="wp.veil" :min="0" :max="85" :step="1" thumb-label hide-details density="compact" :aria-label="$t('setting.wallpaper.veil')"></v-slider>
              <span class="wp-val mono">{{ wp.veil }}%</span>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">{{ $t('setting.wallpaper.fit') }}</div>
            <div class="wp-ctrl">
              <v-btn-toggle v-model="wp.fit" density="compact" mandatory variant="outlined" divided>
                <v-btn value="cover" size="small">{{ $t('setting.wallpaper.fitCover') }}</v-btn>
                <v-btn value="contain" size="small">{{ $t('setting.wallpaper.fitContain') }}</v-btn>
              </v-btn-toggle>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">
              {{ $t('setting.wallpaper.contrastCheck') }}
              <span class="wp-note">{{ $t('setting.wallpaper.contrastHint') }}</span>
            </div>
            <div class="wp-ctrl">
              <span class="wp-ratio mono" :data-ok="wpOk ? '1' : '0'">
                {{ wpContrast < 0 ? '—' : wpContrast.toFixed(1) + ':1' }}
              </span>
              <span class="wp-flag" :data-ok="wpOk ? '1' : '0'">
                {{ wpContrast < 0 ? $t('setting.wallpaper.noSample') : wpOk ? $t('setting.wallpaper.contrastOk') : $t('setting.wallpaper.contrastLow') }}
              </span>
              <v-btn v-if="wpContrast >= 0 && !wpOk" size="small" variant="outlined" @click="fixVeil">{{ $t('setting.wallpaper.fix') }}</v-btn>
            </div>
          </div>

          <div class="wp-line">
            <div class="wp-key">
              {{ $t('setting.wallpaper.glass') }}
              <span class="wp-note">{{ $t('setting.wallpaper.glassWarn') }}</span>
            </div>
            <button
              type="button"
              role="switch"
              class="wp-switch"
              :aria-checked="wp.glass"
              :aria-label="$t('setting.wallpaper.glass')"
              @click="wp.glass = !wp.glass"
            ><span class="wp-switch-knob"></span></button>
          </div>

          <div class="wp-foot">
            <v-btn size="small" variant="text" class="toolbar-ghost" prepend-icon="mdi-restore" @click="clearWp">{{ $t('setting.wallpaper.clear') }}</v-btn>
          </div>
        </div>
      </v-window-item>
    </v-window>
  </v-card-text>
</v-card>
</template>

<script lang="ts" setup>
import { i18n } from '@/locales'
import { Ref, computed, inject, onMounted, onUnmounted, ref } from 'vue'
import HttpUtils, { quietNetworkErrors } from '@/plugins/httputil'
import { FindDiff } from '@/plugins/utils'
import SubJsonExtVue from '@/components/SubJsonExt.vue'
import SubClashExtVue from '@/components/SubClashExt.vue'
import { push } from 'notivue'
import {
  DEFAULT_WP,
  applyWp,
  estimateContrast,
  isDarkNow,
  prepareImage,
  readWp,
  saveParams,
  saveWp,
  suggestVeil,
  type WpConfig,
} from '@/plugins/wallpaper'
import { watch } from 'vue' 
const tab = ref("t1")
const loading:Ref = inject('loading')?? ref(false)
const oldSettings = ref({})

const settings = ref({
	webListen: "",
	webDomain: "",
	webPort: "2095",
	webCertFile: "",
	webKeyFile: "",
  webPath: "/app/",
  webURI: "",
	sessionMaxAge: "0",
  trafficAge: "30",
	timeLocation: "Asia/Tehran",
  subListen: "",
	subPort: "2096",
	subPath: "/sub/",
	subDomain: "",
	subCertFile: "",
	subKeyFile: "",
	subUpdates: "12",
	subEncode: "true",
	subShowInfo: "false",
	subURI: "",
  subJsonExt: "",
  subClashExt: "",
})

const updateInfo = ref<any>(null)
const updating = ref(false)

onMounted(async () => {
  loading.value = true
  await loadData()
  loading.value = false
  // 版本检查放在最后、且不接管 loading:GitHub 不通的时候(被墙、限流)
  // 不该把整个设置页卡住,查不到就当没有更新。
  // 刷新页面/切走再回来时,接着等上次没等完的更新
  const pending = loadPending()
  if (pending) { watchUpdate(pending.to, pending.at); return }
  const msg = await HttpUtils.get('api/updateInfo')
  if (msg.success) updateInfo.value = msg.obj
})

// ---- 面板自更新:点一次就锁住按钮,自己等面板以新版本回来再刷新 ----
// 以前点完只弹一句「请手动刷新」,按钮还能接着点,而面板重启那一两分钟
// 后台轮询全是 503 红条,看着就像更新失败了。
const PENDING_KEY = 'sui-panel-updating'
const UPDATE_TIMEOUT = 5 * 60 * 1000
const updateRunning = ref(false)
const updateFailed = ref(false)
const updateTarget = ref('')
let pollTimer: any = null
const norm = (v: string) => String(v || '').trim().replace(/^v/, '')

const loadPending = (): { to: string, at: number } | null => {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null')
    return p && Date.now() - p.at < UPDATE_TIMEOUT ? p : null
  } catch { return null }
}

const watchUpdate = (to: string, at: number) => {
  updateRunning.value = true
  updateFailed.value = false
  updateTarget.value = to
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ to, at })) } catch {}
  quietNetworkErrors(UPDATE_TIMEOUT)
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (Date.now() - at > UPDATE_TIMEOUT) {
      // 5 分钟还没以新版本回来:别再转圈,说清楚可能卡在哪
      clearInterval(pollTimer)
      updateRunning.value = false
      updateFailed.value = true
      quietNetworkErrors(0)
      try { sessionStorage.removeItem(PENDING_KEY) } catch {}
      return
    }
    const msg = await HttpUtils.get('api/status', { r: 'sys' })
    if (msg.success && norm(msg.obj?.sys?.appVersion) === norm(to)) {
      clearInterval(pollTimer)
      try { sessionStorage.removeItem(PENDING_KEY) } catch {}
      quietNetworkErrors(0)
      push.success({ title: i18n.global.t('actions.updateDone', { v: to }) })
      setTimeout(() => location.reload(), 1500)
    }
  }, 5000)
}

onUnmounted(() => clearInterval(pollTimer))

const updatePanel = async () => {
  if (updateRunning.value) return
  if (!confirm(i18n.global.t('actions.updateConfirm'))) return
  updating.value = true
  const msg = await HttpUtils.post('api/updatePanel', {})
  updating.value = false
  if (msg.success) watchUpdate(updateInfo.value?.latestVersion || '', Date.now())
}

const loadData = async () => {
  loading.value = true
  const msg = await HttpUtils.get('api/settings')
  loading.value = false
  if (msg.success) {
    setData(msg.obj)
  }
}

const setData = (data: any) => {
  settings.value = data
  oldSettings.value = { ...data }
}

const save = async () => {
  loading.value = true
  const msg = await HttpUtils.post('api/save', { object: 'settings', action: 'set', data: JSON.stringify(settings.value) })
  if (msg.success) {
    push.success({
      title: i18n.global.t('success'),
      duration: 5000,
      message: i18n.global.t('actions.set') + " " + i18n.global.t('pages.settings')
    })
    setData(msg.obj.settings)
  }
  loading.value = false
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const restartApp = async () => {
  loading.value = true
  const msg = await HttpUtils.post('api/restartApp',{})
  if (msg.success) {
    let url = settings.value.webURI
    if (url !== "") {
      const isTLS = settings.value.webCertFile !== "" || settings.value.webKeyFile !== ""
      url = buildURL(settings.value.webDomain,settings.value.webPort.toString(),isTLS, settings.value.webPath)
    }
    await sleep(3000)
    window.location.replace(url)
  }
  loading.value = false
}

const buildURL = (host: string, port: string, isTLS: boolean, path: string) => {
  if (!host || host.length == 0) host = window.location.hostname
  if (!port || port.length == 0) port = window.location.port

  const protocol = isTLS ? "https:" : "http:"

  if (port === "" || (isTLS && port === "443") || (!isTLS && port === "80")) {
      port = ""
  } else {
      port = `:${port}`
  }

  return `${protocol}//${host}${port}${path}settings`
}

const subEncode = computed({
  get: () => { return settings.value.subEncode == "true" },
  set: (v:boolean) => { settings.value.subEncode = v ? "true" : "false" }
})

const subShowInfo = computed({
  get: () => { return settings.value.subShowInfo == "true" },
  set: (v:boolean) => { settings.value.subShowInfo = v ? "true" : "false" }
})

const webPort = computed({
  get: () => { return settings.value.webPort.length>0 ? parseInt(settings.value.webPort) : 2095 },
  set: (v:number) => { settings.value.webPort = v>0 ? v.toString() : "2095" }
})

const sessionMaxAge = computed({
  get: () => { return settings.value.sessionMaxAge.length>0 ? parseInt(settings.value.sessionMaxAge) : 0 },
  set: (v:number) => { settings.value.sessionMaxAge = v>0 ? v.toString() : "0" }
})

const trafficAge = computed({
  get: () => { return settings.value.trafficAge.length>0 ? parseInt(settings.value.trafficAge) : 0 },
  set: (v:number) => { settings.value.trafficAge = v>0 ? v.toString() : "0" }
})

const subPort = computed({
  get: () => { return settings.value.subPort.length>0 ? parseInt(settings.value.subPort) : 2096 },
  set: (v:number) => { settings.value.subPort = v>0 ? v.toString() : "2096" }
})

const subUpdates = computed({
  get: () => { return settings.value.subUpdates.length>0 ? parseInt(settings.value.subUpdates) : 12 },
  set: (v:number) => { settings.value.subUpdates = v>0 ? v.toString() : "12" }
})

const stateChange = computed(() => {
  return !FindDiff.deepCompare(settings.value,oldSettings.value)
})

/* ---------------------------------------------------------------- 外观（壁纸） */

const wp = ref<WpConfig>(readWp())
const urlInput = ref('')
const wpBusy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const wpDark = ref(isDarkNow())

const commitWp = () => {
  saveParams(wp.value)
  applyWp(wp.value)
}
watch(wp, commitWp, { deep: true })
// 明暗主题换了，读数也要跟着换（浅色图和深色图各一份）
const themeTick = setInterval(() => { wpDark.value = isDarkNow() }, 1200)
onUnmounted(() => clearInterval(themeTick))

const wpContrast = computed(() => {
  const lum = wpDark.value ? wp.value.lumDark : wp.value.lumLight
  return estimateContrast(lum, wp.value.veil, wpDark.value)
})
const wpOk = computed(() => wpContrast.value < 0 || wpContrast.value >= 4.5)

const setImage = async (input: File | string) => {
  wpBusy.value = true
  try {
    const r = await prepareImage(input)
    if (wpDark.value) {
      wp.value.srcDark = r.src
      wp.value.thumbDark = r.thumb
      wp.value.sampledDark = r.sampled
      wp.value.lumDark = r.lum
    } else {
      wp.value.srcLight = r.src
      wp.value.thumbLight = r.thumb
      wp.value.sampledLight = r.sampled
      wp.value.lumLight = r.lum
    }
    wp.value.builtin = 'none'
    wp.value.on = true
    // 装完先按最坏区域算一个能达标的遮罩，别让人自己摸
    if (r.sampled) wp.value.veil = suggestVeil(r.lum, wpDark.value)
    saveWp(wp.value)
    applyWp(wp.value)
  } catch (e) {
    push.error({ message: i18n.global.t('setting.wallpaper.loadFailed'), duration: 4000 })
  } finally {
    wpBusy.value = false
  }
}

const useUrl = () => {
  const raw = urlInput.value.trim()
  if (!raw) return
  void setImage(raw.startsWith('/') ? location.origin + raw : raw)
}

const onFile = (e: Event) => {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) void setImage(f)
  input.value = ''
}

const fixVeil = () => {
  const lum = wpDark.value ? wp.value.lumDark : wp.value.lumLight
  wp.value.veil = suggestVeil(lum, wpDark.value)
}

const clearWp = () => {
  wp.value = { ...DEFAULT_WP }
  saveWp(wp.value)
  applyWp(wp.value)
  urlInput.value = ''
}

</script>

<style scoped>
/* 外观面板：账簿行式排布（key 左、控件右、1px 细线），不是卡片堆 */
.wp {
  max-width: 860px;
  padding-top: var(--s2);
}

.wp-line {
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
}

.wp-key {
  flex: none;
  width: 190px;
  font-size: var(--fs-sm);
  color: var(--ink-2);
  line-height: 1.4;
}

.wp-note {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.wp-ctrl {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex: 1 1 auto;
  min-width: 0;
}

.wp-ctrl--slider {
  gap: var(--s3);
}

.wp-ctrl--slider .v-slider {
  flex: 1 1 auto;
  max-width: 420px;
}

.wp-url {
  max-width: 420px;
}

.wp-val {
  width: 56px;
  text-align: right;
  font-size: var(--fs-sm);
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.wp-ratio {
  font-size: var(--fs-lg);
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.wp-ratio[data-ok='0'] {
  color: var(--error);
}

.wp-flag {
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
  color: var(--ok);
}

.wp-flag[data-ok='0'] {
  color: var(--error);
}

.wp-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--s3);
}


/* 控件形态：Vuetify 默认滑块是 4px 轨道 + 20px 把手，在账簿里显得笨重 */
.wp {
  --v-slider-track-size: 2px;
  --v-slider-thumb-size: 12px;
}

.wp :deep(.v-slider-track__background),
.wp :deep(.v-slider-track__fill) {
  height: 2px !important;
  border-radius: 1px !important;
}

.wp :deep(.v-slider-track__background) {
  background: var(--rule-strong) !important;
}

.wp :deep(.v-slider-track__fill) {
  background: var(--ink-2) !important;
  border-radius: 1px;
}

.wp :deep(.v-slider-thumb__surface) {
  background: var(--surface) !important;
  border: 1px solid var(--ink-2) !important;
  box-shadow: none !important;
}

.wp :deep(.v-slider-thumb__surface::before) {
  opacity: 0 !important;
}

.wp :deep(.v-slider-thumb__label) {
  background: var(--ink) !important;
  color: var(--paper) !important;
  border-radius: 2px !important;
  font-family: var(--mono);
  font-size: 10px !important;
  min-width: 30px !important;
}

/* 开关：账簿里唯一的「药丸」，因为开关这个语义只能靠形状表达 */
.wp-switch {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--rule-strong);
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.16, 1, 0.3, 1), border-color 160ms;
}

.wp-switch[aria-checked='true'] {
  background: var(--ink);
  border-color: var(--ink);
}

.wp-switch-knob {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 14px;
  height: 14px;
  margin-top: -7px;
  border-radius: 50%;
  background: var(--ink-2);
  transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), background-color 160ms;
}

.wp-switch[aria-checked='true'] .wp-switch-knob {
  transform: translateX(16px);
  background: var(--paper);
}

.wp-switch:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .wp-line {
    flex-direction: column;
    align-items: stretch;
    gap: var(--s1);
  }

  .wp-key {
    width: auto;
  }
}
</style>
