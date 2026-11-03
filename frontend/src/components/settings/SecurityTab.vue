<template>
        <div class="sec">
          <div class="sec-line">
            <div class="sec-key">
              {{ $t('setting.security.status') }}
              <span class="wp-note">{{ $t('setting.security.subtitle') }}</span>
            </div>
            <div class="sec-ctrl">
              <span class="sec-flag" :data-on="otp.on ? '1' : '0'">
                {{ otp.on ? $t('setting.security.on') : $t('setting.security.off') }}
              </span>
              <span v-if="otp.on" class="wp-note">
                {{ $t('setting.security.recoveryLeft') }}：{{ otp.recovery_left }}
              </span>
            </div>
          </div>

          <div v-if="!otp.on" class="sec-body">
            <v-btn size="small" variant="outlined" :loading="otpBusy" @click="startOtpSetup">
              {{ $t('setting.security.enable') }}
            </v-btn>

            <div v-if="otp.secret" class="sec-setup">
              <p class="sec-hint">{{ $t('setting.security.scanHint') }}</p>
              <div class="sec-qr">
                <QrcodeVue :value="otp.uri" :size="168" level="M" render-as="svg" />
              </div>
              <div class="sec-secret mono">{{ otp.secret }}</div>
              <div class="sec-confirm">
                <v-text-field
                  v-model="otpCode"
                  density="compact"
                  hide-details
                  :label="$t('setting.security.codeLabel')"
                  inputmode="numeric"
                  maxlength="6"
                  class="sec-code"
                ></v-text-field>
                <v-btn size="small" color="primary" variant="flat" :loading="otpBusy" @click="enableOtp">
                  {{ $t('setting.security.confirm') }}
                </v-btn>
              </div>
            </div>
          </div>

          <div v-else class="sec-body">
            <div class="sec-confirm">
              <v-text-field
                v-model="otpCode"
                density="compact"
                hide-details
                :label="$t('setting.security.codeLabel')"
                inputmode="numeric"
                maxlength="12"
                class="sec-code"
              ></v-text-field>
              <v-btn size="small" variant="outlined" color="warning" :loading="otpBusy" @click="disableOtp">
                {{ $t('setting.security.disable') }}
              </v-btn>
              <v-btn size="small" variant="text" class="toolbar-ghost" :loading="otpBusy" @click="regenRecovery">
                {{ $t('setting.security.regenerate') }}
              </v-btn>
            </div>
          </div>

          <div v-if="recovery.length" class="sec-recovery">
            <div class="sec-recovery-head">
              <strong>{{ $t('setting.security.recoveryTitle') }}</strong>
              <v-btn size="x-small" variant="text" class="toolbar-ghost" @click="copyRecovery">
                {{ $t('setting.security.copy') }}
              </v-btn>
            </div>
            <p class="wp-note">{{ $t('setting.security.recoveryHint') }}</p>
            <ol class="sec-codes">
              <li v-for="c in recovery" :key="c" class="mono">{{ c }}</li>
            </ol>
          </div>
        </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { i18n } from '@/locales'
import HttpUtils from '@/plugins/httputil'
import { push } from 'notivue'
import QrcodeVue from 'qrcode.vue'

interface OtpState { on: boolean; recovery_left: number; secret: string; uri: string }
const otp = ref<OtpState>({ on: false, recovery_left: 0, secret: '', uri: '' })
const otpCode = ref('')
const otpBusy = ref(false)
const recovery = ref<string[]>([])

const loadOtp = async () => {
  const r = await HttpUtils.get('api/otp/status')
  if (r.success && r.obj) {
    otp.value.on = Boolean((r.obj as any).on)
    otp.value.recovery_left = Number((r.obj as any).recovery_left || 0)
  }
}

const startOtpSetup = async () => {
  otpBusy.value = true
  const r = await HttpUtils.post('api/otp/setup', {})
  otpBusy.value = false
  if (r.success && r.obj) {
    otp.value.secret = String((r.obj as any).secret || '')
    otp.value.uri = String((r.obj as any).uri || '')
    otpCode.value = ''
  }
}

const enableOtp = async () => {
  if (otpCode.value.replace(/[^0-9]/g, '').length !== 6) {
    push.error({ message: i18n.global.t('setting.security.needCode'), duration: 3000 })
    return
  }
  otpBusy.value = true
  const r = await HttpUtils.post('api/otp/enable', { code: otpCode.value })
  otpBusy.value = false
  if (!r.success) return
  recovery.value = (((r.obj as any)?.recovery || []) as string[]).slice()
  otp.value.secret = ''
  otp.value.uri = ''
  otpCode.value = ''
  await loadOtp()
  push.success({ message: i18n.global.t('setting.security.enabled'), duration: 3000 })
}

const disableOtp = async () => {
  otpBusy.value = true
  const r = await HttpUtils.post('api/otp/disable', { code: otpCode.value })
  otpBusy.value = false
  if (!r.success) return
  otpCode.value = ''
  recovery.value = []
  await loadOtp()
  push.success({ message: i18n.global.t('setting.security.disabled'), duration: 3000 })
}

const regenRecovery = async () => {
  otpBusy.value = true
  const r = await HttpUtils.post('api/otp/recovery', { code: otpCode.value })
  otpBusy.value = false
  if (!r.success) return
  recovery.value = (((r.obj as any)?.recovery || []) as string[]).slice()
  await loadOtp()
}

const copyRecovery = async () => {
  try {
    await navigator.clipboard.writeText(recovery.value.join('\n'))
    push.success({ message: i18n.global.t('setting.security.copy'), duration: 2000 })
  } catch {
    /* 剪贴板不可用时用户可手抄 */
  }
}

onMounted(() => { void loadOtp() })
</script>

<style scoped>
/* 安全块：和外观面板同一套账簿行语汇 */
.sec {
  max-width: 720px;
  padding-top: var(--s2);
}

.sec-line {
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
}

.sec-key {
  flex: none;
  width: 190px;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}

.sec-ctrl {
  display: flex;
  align-items: baseline;
  gap: var(--s3);
}

.sec-flag {
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

.sec-flag[data-on='1'] {
  color: var(--ok);
}

.sec-body {
  padding: var(--s4) 0;
  border-bottom: 1px solid var(--rule);
}

.sec-setup {
  margin-top: var(--s4);
}

.sec-hint {
  margin: 0 0 var(--s3);
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

.sec-qr {
  display: inline-block;
  padding: 10px;
  background: #fff;
  border: 1px solid var(--rule);
}

.sec-secret {
  margin: var(--s3) 0;
  font-size: var(--fs-sm);
  color: var(--ink-2);
  letter-spacing: 0.08em;
  word-break: break-all;
}

.sec-confirm {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}

.sec-code {
  max-width: 260px;
}

.sec-recovery {
  padding-top: var(--s4);
}

.sec-recovery-head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-family: var(--serif);
  font-size: var(--fs-lg);
}

.sec-codes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px var(--s4);
  margin: var(--s2) 0 0;
  padding-left: 18px;
  font-size: var(--fs-sm);
  color: var(--ink);
}
</style>
