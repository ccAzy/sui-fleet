<template>
  <v-dialog transition="dialog-bottom-transition" width="560">
    <v-card class="rounded-lg" :loading="loading">
      <v-card-title>{{ $t('actions.' + (form.id ? 'edit' : 'add')) + ' ' + $t('objects.server') }}</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <!-- 新建成功后的「一次性凭据」区：token 只在这里出现一次，节点侧只存 sha256，
             关掉就再也找不回来（以前连显示都没有，只能删节点重建）。 -->
        <template v-if="install">
          <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
            {{ $t('server.installOnce') }}
          </v-alert>
          <div class="install-row">
            <span class="install-label">{{ $t('server.token') }}</span>
            <code class="install-code">{{ install.token }}</code>
            <v-btn size="x-small" variant="text" :prepend-icon="copied === 'token' ? 'mdi-check' : 'mdi-content-copy'"
              @click="copy(install.token, 'token')">{{ $t('server.copy') }}</v-btn>
          </div>
          <div class="install-row install-row--block">
            <span class="install-label">{{ $t('server.installCmd') }}</span>
            <code class="install-code">{{ install.install_cmd }}</code>
            <v-btn size="x-small" variant="text" :prepend-icon="copied === 'cmd' ? 'mdi-check' : 'mdi-content-copy'"
              @click="copy(install.install_cmd, 'cmd')">{{ $t('server.copy') }}</v-btn>
          </div>
          <p class="install-hint">{{ $t('server.installHint') }}</p>
        </template>
        <v-container v-else style="padding: 0;">
          <v-row>
            <v-col cols="12">
              <v-text-field
                :label="$t('server.name')"
                v-model="form.name"
                hide-details>
              </v-text-field>
            </v-col>
            <v-col cols="12">
              <v-text-field
                :label="$t('server.url')"
                :hint="$t('server.urlHint')"
                persistent-hint
                v-model="form.url"
                placeholder="http://1.2.3.4:2095/path/">
              </v-text-field>
            </v-col>
            <v-col cols="12">
              <v-text-field
                :label="$t('server.token')"
                :hint="$t('server.tokenHint')"
                persistent-hint
                :type="showPass ? 'text' : 'password'"
                :append-inner-icon="showPass ? 'mdi-eye-off' : 'mdi-eye'"
                @click:append-inner="showPass = !showPass"
                v-model="form.token">
              </v-text-field>
            </v-col>
            <v-col cols="12">
              <v-text-field
                :label="$t('server.remark')"
                v-model="form.remark"
                hide-details>
              </v-text-field>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" variant="outlined" @click="closeModal">{{ $t('actions.close') }}</v-btn>
        <v-btn v-if="!install" color="primary" variant="tonal" :loading="loading" @click="save">{{ $t('actions.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import Data from '@/store/modules/data'
import { i18n } from '@/locales'
import { push } from 'notivue'

export default {
  props: ['visible', 'server'],
  emits: ['close'],
  data() {
    return {
      loading: false,
      showPass: false,
      // 新建成功后展示一次性 token + 安装命令；null 表示正常编辑态
      install: <any>null,
      copied: '',
      form: { id: 0, name: '', url: '', token: '', remark: '' },
    }
  },
  watch: {
    visible(v: boolean) {
      if (v) {
        const s = this.$props.server
        this.form = s
          ? { id: s.id, name: s.name, url: s.url, token: s.token ?? '', remark: s.remark }
          : { id: 0, name: '', url: '', token: '', remark: '' }
        this.showPass = false
        this.loading = false
      }
    },
  },
  methods: {
    closeModal() {
      this.install = null
      this.copied = ''
      this.$emit('close')
    },
    normalizeUrl(u: string): string {
      u = (u || '').trim()
      if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u
      return u
    },
    async copy(text: any, which: string) {
      try {
        await navigator.clipboard.writeText(String(text ?? ''))
        this.copied = which
        setTimeout(() => {
          if (this.copied === which) this.copied = ''
        }, 1500)
      } catch {
        // 浏览器拒绝剪贴板时，内容本身在弹窗里可以手动选中
      }
    },
    async save() {
      const name = (this.form.name || '').trim()
      const url = this.normalizeUrl(this.form.url)
      if (!name || !url) {
        push.error({ message: i18n.global.t('error.invalidData') + ': ' + i18n.global.t('server.url') })
        return
      }
      this.loading = true
      const payload: any = {
        name,
        url,
        token: (this.form.token || '').trim(),
        remark: (this.form.remark || '').trim(),
      }
      if (this.form.id) payload.id = this.form.id
      const success = await Data().save('servers', this.form.id ? 'edit' : 'new', payload)
      this.loading = false
      if (!success) return
      // 新建时后端只回一次明文 token；把它留在弹窗里让用户复制，别直接关掉
      const created = Data().lastCreated
      if (created && !this.form.id) {
        Data().lastCreated = null
        this.install = created
        return
      }
      this.closeModal()
    },
  },
}
</script>

<style scoped>
/* 这个文件原先没有 style 块；一次性凭据区需要等宽与自动换行 */
.install-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.install-row--block {
  align-items: flex-start;
}

.install-label {
  flex: 0 0 88px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.install-code {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.5;
  word-break: break-all;
  user-select: all;
}

.install-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
</style>
