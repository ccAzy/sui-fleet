<template>
  <v-dialog transition="dialog-bottom-transition" width="90%" max-width="1200" :loading="loading">
    <v-card class="rounded-lg">
      <v-card-title>
        <v-row>
          <v-col>{{ $t('basic.log.title') }}</v-col>
          <v-spacer></v-spacer>
          <v-col cols="auto">
            <v-icon icon="mdi-close" @click="control.visible = false" />
          </v-col>
        </v-row>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-select
            hide-details
            :label="$t('basic.log.level')"
            :items="logLevels"
            v-model="logLevel"
            @update:model-value="loadData">
            </v-select>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-select
            hide-details
            :label="$t('count')"
            :items="[10,20,30,50,100]"
            v-model.number="logCount"
            @update:model-value="loadData">
            </v-select>
          </v-col>
          <v-col cols="auto" align="center" justify="center">
            <v-btn
              icon="mdi-refresh"
              variant="tonal"
              :loading="loading"
              @click="loadData">
              <v-icon  />
            </v-btn>
          </v-col>
        </v-row>
        <!-- 不能用 v-html：日志里有节点侧可控字符串（SNI/域名），一旦日志功能修好就是注入面 -->
        <!-- 这个文件没有 <style> 块（改之前踩过：往里加 class 是静默 no-op），
             换行与等宽只能写在行内。 -->
        <v-card
          style="background-color: rgb(var(--v-theme-surface-variant)); white-space: pre-wrap; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.55; padding: 10px 12px; max-height: 60vh; overflow: auto;"
          dir="ltr"
        >{{ lines.join('\n') }}</v-card>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import HttpUtils from '@/plugins/httputil'

export default {
  props: ['control', 'visible'],
  data() {
    return {
      loading: false,
      lines: [],
      logLevel: 'info',
      logLevels: [
        { title: 'DEBUG', value: 'debug' },
        { title: 'INFO', value: 'info' },
        { title: 'WARNING', value: 'warning' },
        { title: 'ERROR', value: 'err' },
      ],
      logCount: 10,
    }
  },
  methods: {
    async loadData() {
      this.loading = true
      const data = await HttpUtils.get('api/logs',{ c: this.logLevel, l: this.logCount })
      if (data.success) {
        this.lines = data.obj?? []
        this.loading = false
      }
    }
  },
  watch: {
    visible(v) {
      this.lines = []
      this.logLevel = 'info'
      this.logCount = 10
      if (v) {
        this.loadData()
      }
    },
  },
}
</script>