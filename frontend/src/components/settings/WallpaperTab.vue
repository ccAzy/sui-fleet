<template>
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
            <div class="wp-key">
              {{ $t('setting.wallpaper.paper') }}
              <span class="wp-note">{{ $t('setting.wallpaper.paperHint') }}</span>
            </div>
            <div class="wp-ctrl wp-ctrl--slider">
              <v-slider v-model="wp.paper" :min="60" :max="100" :step="1" thumb-label hide-details density="compact" :aria-label="$t('setting.wallpaper.paper')"></v-slider>
              <span class="wp-val mono">{{ wp.paper }}%</span>
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
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { push } from 'notivue'
import { i18n } from '@/locales'
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
  return estimateContrast(lum, wp.value.veil, wpDark.value, wp.value.paper)
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
