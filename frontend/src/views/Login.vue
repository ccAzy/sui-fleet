<template>
  <v-app>
    <div class="login-page">
      <div class="login-glow login-glow--a" aria-hidden="true"></div>
      <div class="login-glow login-glow--b" aria-hidden="true"></div>

      <div class="login-card">
        <header class="login-head">
          <div class="login-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round">
              <path d="M12 2L3 7v10l9 5 9-5V7z" />
              <path d="M12 12l9-5M12 12v10M12 12L3 7" />
            </svg>
          </div>
          <h1 class="login-title">s-ui <i>cloud</i></h1>
          <p class="login-sub">{{ $t('login.tagline') }}</p>
        </header>

        <form v-if="step === 'pass'" class="login-form" autocomplete="on" @submit.prevent="login">
          <label class="field">
            <span class="field-label">{{ $t('login.username') }}</span>
            <input
              v-model="username"
              class="field-input"
              name="username"
              autocomplete="username"
              spellcheck="false"
              required
            />
          </label>

          <label class="field">
            <span class="field-label">{{ $t('login.password') }}</span>
            <input
              v-model="password"
              class="field-input"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>

          <p v-if="error" class="login-error">{{ error }}</p>

          <button type="submit" class="login-submit" :disabled="loading">
            <span v-if="loading" class="login-spinner" aria-hidden="true"></span>
            {{ loading ? '' : $t('actions.submit') }}
            <svg
              v-if="!loading"
              class="login-arrow"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
            >
              <path d="M5 12h13M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </form>

        <!-- 第二步：二次验证。密码只换到一张 120 秒的票据，真正的会话在这里才发。 -->
        <form v-else class="login-form" autocomplete="off" @submit.prevent="submitOtp">
          <p class="login-note">
            {{ useRecovery ? $t('login.useRecoveryHint') : $t('login.otpHint') }}
          </p>

          <label class="field">
            <span class="field-label">{{ useRecovery ? $t('login.recoveryCode') : $t('login.otpCode') }}</span>
            <input
              v-model="code"
              class="field-input"
              :class="{ 'field-input--code': !useRecovery }"
              :name="useRecovery ? 'recovery' : 'otp'"
              :inputmode="useRecovery ? 'text' : 'numeric'"
              autocomplete="one-time-code"
              :maxlength="useRecovery ? 12 : 6"
              spellcheck="false"
              autofocus
              required
            />
          </label>

          <p v-if="error" class="login-error">{{ error }}</p>

          <button type="submit" class="login-submit" :disabled="loading">
            <span v-if="loading" class="login-spinner" aria-hidden="true"></span>
            {{ loading ? '' : $t('actions.submit') }}
          </button>

          <div class="login-alt">
            <button type="button" class="linkish" @click="toggleRecovery">
              {{ useRecovery ? $t('login.useTotp') : $t('login.useRecovery') }}
            </button>
            <span class="dot">·</span>
            <button type="button" class="linkish" @click="backToPass">{{ $t('login.back') }}</button>
          </div>
        </form>

        <footer class="login-foot">
          <span class="login-sep" aria-hidden="true"></span>
          <label class="login-lang">
            <span class="sr-only">Language</span>
            <select :value="$i18n.locale" @change="changeLocale(($event.target as HTMLSelectElement).value)">
              <option v-for="l in languages" :key="l.value" :value="l.value">{{ l.title }}</option>
            </select>
          </label>
        </footer>
      </div>
    </div>
  </v-app>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useLocale } from 'vuetify'
import { i18n, languages, setLocale } from '@/locales'
import { useRouter } from 'vue-router'
import HttpUtil from '@/plugins/httputil'

const locale = useLocale()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const router = useRouter()

// 两步登录：pass → otp。ticket 是密码换来的 120 秒临时票据，不能直接当会话用。
const step = ref<'pass' | 'otp'>('pass')
const ticket = ref('')
const code = ref('')
const useRecovery = ref(false)

const toggleRecovery = () => {
  useRecovery.value = !useRecovery.value
  code.value = ''
  error.value = ''
}

const backToPass = () => {
  step.value = 'pass'
  code.value = ''
  ticket.value = ''
  error.value = ''
}

const login = async () => {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = !username.value ? i18n.global.t('login.unRules') : i18n.global.t('login.pwRules')
    return
  }
  loading.value = true
  const response = await HttpUtil.post('api/login', { user: username.value, pass: password.value })
  loading.value = false
  if (!response.success) {
    error.value = String((response as any).msg || 'Invalid login')
    return
  }
  // 开了二次验证：后端不会发会话 cookie，只给一张票据
  const obj = (response.obj || {}) as any
  if (obj.need_otp) {
    ticket.value = String(obj.ticket || '')
    step.value = 'otp'
    code.value = ''
    error.value = ''
    return
  }
  finish(obj)
}

const submitOtp = async () => {
  error.value = ''
  const value = code.value.trim()
  if (!value) {
    error.value = i18n.global.t('login.otpRequired')
    return
  }
  loading.value = true
  const response = await HttpUtil.post('api/login/otp', { ticket: ticket.value, code: value })
  loading.value = false
  if (!response.success) {
    error.value = String((response as any).msg || i18n.global.t('login.otpInvalid'))
    code.value = ''
    return
  }
  finish((response.obj || {}) as any)
}

const finish = (obj: any) => {
  // 首次用默认密码登录：直接带去改密页，避免面板长期用 admin/admin 裸奔
  router.push(obj?.must_change ? '/admins' : '/')
}

const changeLocale = async (l: string) => {
  await setLocale(l ?? 'en')       // 先加载词条再切，避免闪 key 名
  locale.current.value = l ?? 'en' // Vuetify 自己的语言（分页/表格等内置文案）
}
</script>

<style scoped>
/* 扉页：纸上的一张卡片，两侧各一团光晕做纵深 */
.login-page {
  position: relative;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 48px 24px;
  overflow: hidden;
  background: var(--paper);
}

.login-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  pointer-events: none;
}
.login-glow--a {
  width: 620px;
  height: 420px;
  left: -140px;
  top: -120px;
  background: radial-gradient(circle, var(--glow-1), transparent 66%);
}
.login-glow--b {
  width: 560px;
  height: 380px;
  right: -120px;
  bottom: -140px;
  background: radial-gradient(circle, var(--glow-2), transparent 66%);
}

.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 372px;
  padding: 30px 28px 18px;
  border-radius: 16px;
  border: 1px solid var(--card-line);
  background: var(--card-bg);
  box-shadow: var(--card-shadow), 0 30px 70px -30px rgba(0, 0, 0, 0.45);
}

.login-head {
  margin-bottom: 24px;
}

.login-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: linear-gradient(
    140deg,
    color-mix(in srgb, var(--accent) 70%, #fff),
    var(--accent) 45%,
    var(--accent-2)
  );
  box-shadow: 0 0 22px -2px var(--accent), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  margin-bottom: 16px;
}
.login-mark svg {
  width: 17px;
  height: 17px;
}

.login-title {
  margin: 0;
  font-family: var(--serif);
  font-size: 25px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.01em;
  background: linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 55%, var(--ink-3)));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.login-title i {
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  -webkit-text-fill-color: var(--ink-3);
  margin-left: 6px;
}

.login-sub {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: block;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 9.5px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 700;
}

.field-input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid var(--rule-strong);
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  color: var(--ink);
  font-size: 13.5px;
  font-family: var(--sans);
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}
.field-input::placeholder {
  color: var(--ink-3);
}
.field-input:hover {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--rule-strong));
}
.field-input:focus {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.field-input--code {
  font-family: var(--mono);
  letter-spacing: 0.4em;
  text-align: center;
}

.login-error {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--error);
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--error-soft);
  border: 1px solid color-mix(in srgb, var(--error) 26%, transparent);
}

.login-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-2);
}

.login-submit {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  margin-top: 4px;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 72%, #fff),
    var(--accent) 42%,
    var(--accent-2)
  );
  box-shadow: 0 10px 26px -10px var(--accent), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.16s ease, opacity 0.16s ease;
}
.login-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 32px -10px var(--accent), inset 0 1px 0 rgba(255, 255, 255, 0.36);
}
.login-submit:active:not(:disabled) {
  transform: translateY(0) scale(0.995);
}
.login-submit:disabled {
  cursor: progress;
  opacity: 0.75;
}

.login-arrow {
  width: 15px;
  height: 15px;
  transition: transform 0.16s ease;
}
.login-submit:hover:not(:disabled) .login-arrow {
  transform: translateX(2px);
}

.login-spinner {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: login-spin 0.7s linear infinite;
}
@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}

.login-alt {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 2px;
}
.linkish {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-3);
  transition: color 0.15s ease;
}
.linkish:hover {
  color: var(--accent);
}
.dot {
  color: var(--ink-3);
  opacity: 0.6;
}

.login-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
}
.login-sep {
  flex: 1;
}
.login-lang select {
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font-size: 11.5px;
  cursor: pointer;
  outline: none;
  padding: 2px 0;
}
.login-lang select:hover {
  color: var(--ink-2);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 480px) {
  .login-card {
    padding: 26px 20px 16px;
    border-radius: 14px;
  }
  .login-title {
    font-size: 22px;
  }
}
</style>
