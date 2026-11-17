<template>
  <v-dialog transition="dialog-bottom-transition" width="400">
    <v-card class="rounded-lg" id="qrcode-modal" :loading="loading">
      <v-card-title>
        <v-row>
          <v-col>QrCode</v-col>
          <v-spacer></v-spacer>
          <v-col cols="auto"><v-icon icon="mdi-close-box" @click="$emit('close')" /></v-col>
        </v-row>
      </v-card-title>
      <v-divider></v-divider>
      <v-skeleton-loader
          class="mx-auto border"
          width="80%"
          type="text, image, divider, text, image"
          v-if="loading"
        ></v-skeleton-loader>
      <v-card-text style="overflow-y: auto; padding: 0" :hidden="loading">
        <v-tabs
          v-model="tab"
          density="compact"
          fixed-tabs
          align-tabs="center"
        >
          <v-tab value="link">{{ $t('client.links') }}</v-tab>
          <v-tab value="sub">{{ $t('setting.sub') }}</v-tab>
        </v-tabs>
        <v-window v-model="tab" style="margin-top: 10px;">
          <v-window-item value="sub">
            <v-row>
              <v-col style="text-align: center;">
                <v-chip>{{ $t('setting.sub') }}</v-chip><br />
                <QrcodeVue :value="clientSub" :size="size" @click="copyToClipboard(clientSub)" :margin="1" style="border-radius: 1rem; cursor: copy;" />
              </v-col>
            </v-row>
            <v-row>
              <v-col style="text-align: center;">
                <v-chip>{{ $t('setting.jsonSub') }}</v-chip><br />
                <QrcodeVue :value="jsonSub" :size="size" @click="copyToClipboard(jsonSub)" :margin="1" style="border-radius: 1rem; cursor: copy;" />
              </v-col>
            </v-row>
            <v-row>
              <v-col style="text-align: center;">
                <v-chip>{{ $t('setting.clashSub') }}</v-chip><br />
                <QrcodeVue :value="clashSub" :size="size" @click="copyToClipboard(clashSub)" :margin="1" style="border-radius: 1rem; cursor: copy;" />
              </v-col>
            </v-row>
            <v-row>
              <v-col style="text-align: center;">
                <v-chip>SING-BOX (scan only)</v-chip><br />
                <QrcodeVue :value="singbox" :size="size" :margin="1" style="border-radius: .8rem; cursor: not-allowed;" />
              </v-col>
            </v-row>
          </v-window-item>
          <v-window-item value="link">
            <v-row v-for="(l, index) in clientLinks" :key="index">
              <v-col style="text-align: center;">
                <v-chip>{{ l.remark?? $t('client.' + l.type) }}</v-chip><br />
                <QrcodeVue :value="l.uri" :size="size" @click="copyToClipboard(l.uri)" :margin="1" style="border-radius: .5rem; cursor: copy;" />
              </v-col>
            </v-row>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import QrcodeVue from 'qrcode.vue'
import Data from '@/store/modules/data'
import { clientSubUrl, withQuery } from '@/plugins/subUrl'
import Clipboard from 'clipboard'
import { i18n } from '@/locales'
import { push } from 'notivue'

export default {
  props: ['id', 'visible'],
  data() {
    return {
      tab: "link",
      client: <any>{},
      loading: false,
    }
  },
  methods: {
    async load() {
      this.loading = true
      const newData = await Data().loadClients(this.$props.id)
      this.client = newData
      this.loading = false
    },
    copyToClipboard(txt:string) {
      const hiddenButton = document.createElement('button')
      hiddenButton.className = 'clipboard-btn'
      document.body.appendChild(hiddenButton)

      const clipboard = new Clipboard('.clipboard-btn', {
        text: () => txt,
        container: document.getElementById('qrcode-modal')?? undefined
      });

      clipboard.on('success', () => {
        clipboard.destroy()
        push.success({
          message: i18n.global.t('success') + ": " + i18n.global.t('copyToClipboard'),
          duration: 5000,
        })
      })

      clipboard.on('error', () => {
        clipboard.destroy()
        push.error({
          message: i18n.global.t('failed') + ": " + i18n.global.t('copyToClipboard'),
          duration: 5000,
        })
      })

      // Perform click on hidden button to trigger copy
      hiddenButton.click()
      document.body.removeChild(hiddenButton)
    }
  },
  computed: {
    clientSub() {
      // subURI 形如 `.../sub/<id>?k=<sub_key>`。sub_key 是**节点级**的，
      // client= 只是过滤参数 —— 去掉它就能拿到同节点所有人的链接。
      // 所以优先发 `?t=<sub_token>`：令牌自带作用域，链接本身就是凭据。
      // 两种部署的 subURI 形状不同（面板带 ?k=，Go 单机不带查询串），
      // 查询参数一律走 clientSubUrl/withQuery，不要手写 `&client=`。
      const c = this.client as any
      return clientSubUrl(Data().subURI, c.sub_token, c.name)
    },
    // 模板里不能直接调外部函数，所以把带格式的地址做成 computed
    jsonSub() {
      return withQuery(this.clientSub, "format", "json")
    },
    clashSub() {
      return withQuery(this.clientSub, "format", "clash")
    },
    singbox() {
      const url = withQuery(this.clientSub, "type", "json")
      return "sing-box://import-remote-profile?url=" +  encodeURIComponent(url) + "#" + this.client.name
    },
    clientLinks() {
      return this.client.links?? []
    },
    size() {
      if (window.innerWidth > 380) return 300
      if (window.innerWidth > 330) return 280
      return 250
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.tab = "link"
        this.load()
      }
    },
  },
  components: { QrcodeVue }
}
</script>