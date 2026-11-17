<template>
  <v-app>
    <div class="login-page">
      <div class="login-sheet">
        <header class="login-head">
          <h1 class="login-title">s-ui cloud</h1>
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

          <Button type="submit" :disabled="loading" class="mt-[6px] w-full">
            {{ loading ? '…' : $t('actions.submit') }}
          </Button>
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
              :autocomplete="useRecovery ? 'one-time-code' : 'one-time-code'"
              :maxlength="useRecovery ? 12 : 6"
              spellcheck="false"
              autofocus
              required
            />
          </label>

          <p v-if="error" class="login-error">{{ error }}</p>

          <Button type="submit" :disabled="loading" class="mt-[6px] w-full">
            {{ loading ? '…' : $t('actions.submit') }}
          </Button>

          <div class="login-alt">
            <button type="button" class="linkish" @click="toggleRecovery">
              {{ useRecovery ? $t('login.useTotp') : $t('login.useRecovery') }}
            </button>
            <span class="dot">·</span>
            <button type="button" class="linkish" @click="backToPass">{{ $t('login.back') }}</button>
          </div>
        </form>

        <footer class="login-foot">

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
import Button from '@/components/ui/button/Button.vue'

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
/* 扉页：不要卡片框，直接排版在纸面上 */
.login-page {
  min-height: 100svh;   /* 不用 100vh：手机上 100vh 是地址栏收起后的高度，会被裁 */
  display: grid;
  place-items: center;
  padding: 48px 24px;
  background: var(--paper);
}

.login-sheet {
  width: 100%;
  max-width: 340px;
}

.login-head {
  margin-bottom: 40px;
}

.login-title {
  font-family: var(--serif);
  font-size: var(--fs-2xl);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.01em;
  color: var(--ink);
  margin: 0;
}

/* 标题下的一条短线，全站统一的纸面语言 */
.login-title::after {
  content: "";
  display: block;
  width: 28px;
  height: 1px;
  margin-top: 14px;
  background: var(--ink);
}

.login-sub {
  margin: 14px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
  letter-spacing: 0.02em;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.field {
  display: block;
}

.field-label {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 2px;
}

.field-input {
  width: 100%;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  border-radius: 0;
  padding: 0;
  height: 30px;
  line-height: 30px;
  font-family: var(--sans);
  font-size: var(--fs-lg);
  color: var(--ink);
  outline: none;
  transition: border-color 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.field-input:focus {
  border-bottom-color: var(--accent);
}

.field-input::placeholder {
  color: var(--ink-3);
}

.login-error {
  margin: -8px 0 0;
  font-size: var(--fs-sm);
  color: var(--error);
}




.login-foot {
  margin-top: 44px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.login-lang select {
  background: transparent;
  border: 1px solid var(--rule-strong);
  border-radius: 2px;
  color: var(--ink-2);
  font-family: var(--sans);
  font-size: var(--fs-xs);
  padding: 4px 6px;
  cursor: pointer;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.login-note {
  margin: 0 0 20px;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--ink-3);
}

/* 6 位码用等宽 + 字距，一眼看清每一位 */
.field-input--code {
  font-family: var(--mono);
  font-size: var(--fs-xl);
  letter-spacing: 0.32em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.login-alt {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

.linkish {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink-2);
  font-size: var(--fs-sm);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--rule-strong);
}

.linkish:hover {
  color: var(--accent);
  text-decoration-color: var(--accent);
}

.login-alt .dot {
  color: var(--rule-strong);
}
</style>
