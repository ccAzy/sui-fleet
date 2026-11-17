<template>
  <EndpointVue 
    v-model="modal.visible"
    :visible="modal.visible"
    :id="modal.id"
    :data="modal.data"
    :tags="endpointTags"
    @close="closeModal"
  />
  <Stats
    v-model="stats.visible"
    :visible="stats.visible"
    :resource="stats.resource"
    :tag="stats.tag"
    @close="closeStats"
  />
  <QrCode
    v-model="qrcode.visible"
    :visible="qrcode.visible"
    :data="qrcode.data"
    @close="closeQrCode"
  />
  <v-row>
    <v-col cols="12" class="page-toolbar">
      <v-btn color="primary" @click="showModal(0)">{{ $t('actions.add') }}</v-btn>
    </v-col>
  </v-row>
  <v-row>
    <div v-if="!endpoints.length" class="list-empty">
      {{ $t('emptyList') }}
    </div>
    <div class="ep-ledger">
      <div v-for="(item, index) in <any[]>endpoints" :key="item.tag" class="ledger-row">
        <span class="ledger-mark" :data-state="onlines.includes(item.tag) ? 'up' : 'down'" aria-hidden="true"></span>
        <span class="ledger-name" :title="item.tag">{{ item.tag }}</span>
        <span class="ledger-meta">
          {{ item.type }}
          <span class="sep">·</span><span class="mono">{{ item.address?.length > 0 ? item.address[0] : '-' }}</span>
          <span class="sep">·</span><span class="mono">:{{ item.listen_port > 0 ? item.listen_port : '-' }}</span>
          <template v-if="item.peers?.length">
            <span class="sep">·</span>{{ $t('types.wg.peers') }}{{ ' ' }}<span class="mono">{{ item.peers.length }}</span>
          </template>
          <template v-if="onlines.includes(item.tag)">
            <span class="sep">·</span>{{ $t('online') }}
          </template>
        </span>
        <div class="ledger-actions">
          <button type="button" class="ui-reset ep-btn" :title="$t('actions.edit')" @click="showModal(item.id)">
            <v-icon icon="mdi-file-edit" size="16" />
          </button>
          <button
            v-if="item.type == 'wireguard' && item.peers?.length > 0"
            type="button"
            class="ui-reset ep-btn"
            title="QR"
            @click="showQrCode(item.id)"
          >
            <v-icon icon="mdi-qrcode" size="16" />
          </button>
          <button v-if="Data().enableTraffic" type="button" class="ui-reset ep-btn" :title="$t('stats.graphTitle')" @click="showStats(item.tag)">
            <v-icon icon="mdi-chart-line" size="16" />
          </button>
          <button type="button" class="ui-reset ep-btn ep-btn--danger" :title="$t('actions.del')" @click="delOverlay[index] = true">
            <v-icon icon="mdi-file-remove" size="16" />
          </button>
        </div>
        <v-overlay v-model="delOverlay[index]" contained class="align-center justify-center">
          <v-card :title="$t('actions.del')">
            <v-card-text>{{ $t('confirm') }}</v-card-text>
            <v-card-actions>
              <v-btn variant="text" class="confirm-cancel" @click="delOverlay[index] = false">{{ $t('no') }}</v-btn>
              <v-btn color="error" variant="flat" @click="delEndpoint(item.tag)">{{ $t('yes') }}</v-btn>
            </v-card-actions>
          </v-card>
        </v-overlay>
      </div>
    </div>
  </v-row>
</template>

<script lang="ts" setup>
import Data from '@/store/modules/data'
import EndpointVue from '@/layouts/modals/Endpoint.vue'
import Stats from '@/layouts/modals/Stats.vue'
import QrCode from '@/layouts/modals/WgQrCode.vue'
import { Endpoint } from '@/types/endpoints'
import { computed, ref } from 'vue'

const endpoints = computed((): Endpoint[] => {
  return <Endpoint[]> Data().endpoints
})

const endpointTags = computed((): any[] => {
  return endpoints.value?.map((o:Endpoint) => o.tag)
})

const onlines = computed(() => {
  return [...Data().onlines.inbound?? [], ...Data().onlines.outbound??[] ]
})

const modal = ref({
  visible: false,
  id: 0,
  data: "",
})

let delOverlay = ref([] as boolean[])

const showModal = (id: number) => {
  modal.value.id = id
  modal.value.data = id == 0 ? '' : JSON.stringify(endpoints.value.findLast(o => o.id == id))
  modal.value.visible = true
}

const closeModal = () => {
  modal.value.visible = false
}

const stats = ref({
  visible: false,
  resource: "endpoint",
  tag: "",
})

const delEndpoint = async (tag: string) => {
  const index = endpoints.value.findIndex(i => i.tag == tag)
  const success = await Data().save("endpoints", "del", tag)
  if (success) delOverlay.value[index] = false
}

const showStats = (tag: string) => {
  stats.value.tag = tag
  stats.value.visible = true
}
const closeStats = () => {
  stats.value.visible = false
}

const qrcode = ref({
  visible: false,
  data: <any>{},
})

const showQrCode = (id: number) => {
  qrcode.value.data = endpoints.value.findLast(o => o.id == id)
  qrcode.value.visible = true
}
const closeQrCode = () => {
  qrcode.value.visible = false
}
</script>
<style scoped>
/* 端点页：卡片墙 → 账簿名录 */
.ep-ledger {
  border: 1px solid var(--card-line);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  padding: 0 16px;
  overflow: hidden;
  width: 100%;
}

.ep-ledger :deep(.ledger-row) {
  grid-template-columns: 14px minmax(0, 220px) minmax(0, 1fr) auto;
  padding-top: 10px;
  padding-bottom: 10px;
}

.ep-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--ink-3);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.ep-btn:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  color: var(--ink);
}

.ep-btn--danger:hover {
  background: var(--error-soft);
  color: var(--error);
}
</style>
