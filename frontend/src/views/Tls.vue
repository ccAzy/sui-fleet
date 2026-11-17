<template>
    <TlsVue 
    v-model="modal.visible"
    :visible="modal.visible"
    :id="modal.id"
    :data="modal.data"
    @close="closeModal"
    @save="saveModal"
  />
  <v-row>
    <v-col cols="12" class="page-toolbar">
      <v-btn color="primary" @click="showModal(0)">{{ $t('actions.add') }}</v-btn>
    </v-col>
  </v-row>
  <v-row>
    <div class="tls-ledger">
      <div v-for="(item, index) in <any[]>tlsConfigs" :key="item.id" class="ledger-row">
        <span class="ledger-mark" :data-state="item.server?.reality ? 'up' : 'down'" aria-hidden="true"></span>
        <span class="ledger-name" :title="item.name">{{ item.name }}</span>
        <span class="ledger-meta">
          <span class="mono">{{ item.server?.server_name || '-' }}</span>
          <template v-if="tlsInbounds(item.id).length">
            <span class="sep">·</span>{{ $t('pages.inbounds') }}&nbsp;<span class="mono">{{ tlsInbounds(item.id).length }}</span>
          </template>
          <template v-if="item.server?.acme != undefined"><span class="sep">·</span>ACME</template>
          <template v-if="item.server?.ech != undefined"><span class="sep">·</span>ECH</template>
          <template v-if="item.server?.reality != undefined"><span class="sep">·</span>Reality</template>
        </span>
        <div class="ledger-actions">
          <button type="button" class="ui-reset tls-btn" :title="$t('actions.edit')" @click="showModal(item.id)">
            <v-icon icon="mdi-file-edit" size="16" />
          </button>
          <button
            v-if="tlsInbounds(item.id).length == 0"
            type="button"
            class="ui-reset tls-btn tls-btn--danger"
            :title="$t('actions.del')"
            @click="delOverlay[index] = true"
          >
            <v-icon icon="mdi-file-remove" size="16" />
          </button>
        </div>
        <v-overlay v-model="delOverlay[index]" contained class="align-center justify-center">
          <v-card :title="$t('actions.del')">
            <v-card-text>{{ $t('confirm') }}</v-card-text>
            <v-card-actions>
              <v-btn variant="text" class="confirm-cancel" @click="delOverlay[index] = false">{{ $t('no') }}</v-btn>
              <v-btn color="error" variant="flat" @click="delTls(item.id)">{{ $t('yes') }}</v-btn>
            </v-card-actions>
          </v-card>
        </v-overlay>
      </div>
    </div>
  </v-row>
</template>

<script lang="ts" setup>
import TlsVue from '@/layouts/modals/Tls.vue'
import Data from '@/store/modules/data'
import { computed, ref } from 'vue'
import { Inbound } from '@/types/inbounds'
import { tls } from '@/types/tls'

const tlsConfigs = computed((): any[] => {
  return Data().tlsConfigs
})

const inbounds = computed((): Inbound[] => {
  return Data().inbounds
})

// 按 tls_id 预建索引：模板里每张 TLS 卡片原本要调 3 次 tlsInbounds()，
// 每次都 filter 一遗 inbounds，总代价 O(TLS × inbounds)。改成一次 O(n) 建表。
const tlsInboundsMap = computed(() => {
  const m = new Map<string, string[]>()
  for (const i of inbounds.value) {
    if (i.tls_id === undefined || i.tls_id === null) continue
    const key = String(i.tls_id)
    const arr = m.get(key)
    if (arr) arr.push(i.tag)
    else m.set(key, [i.tag])
  }
  return m
})

const tlsInbounds = (id: number): string[] => tlsInboundsMap.value.get(String(id)) ?? []

const modal = ref({
  visible: false,
  id: 0,
  data: "",
})

const delOverlay = ref(new Array<boolean>(tlsConfigs.value.length).fill(false))

const showModal = (id: number) => {
  modal.value.id = id
  modal.value.data = id == 0 ? '{}' : JSON.stringify(tlsConfigs.value.findLast(t => t.id == id))
  modal.value.visible = true
}
const clone = (obj: any) => {
  let data = JSON.parse(JSON.stringify(obj))
  data.id = 0
  while (tlsConfigs.value.findIndex(t => t.name == data.name) != -1){
    data.name += "-copy"
  }
  saveModal(data)
}
const closeModal = () => {
  modal.value.visible = false
}
const saveModal = async (data:tls) => {
  const success = await Data().save("tls", data.id > 0 ? "edit" : "new", data)
  if (success) modal.value.visible = false
}

const delTls = async (id: number) => {
  const index = tlsConfigs.value.findIndex(t => t.id == id)
  const success = await Data().save("tls", "del", id)
  if (success) delOverlay.value[index] = false
}

</script>

<style scoped>
/* 证书页：卡片墙 → 账簿名录 */
.tls-ledger {
  border: 1px solid var(--card-line);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  padding: 0 16px;
  overflow: hidden;
  width: 100%;
}

.tls-ledger :deep(.ledger-row) {
  grid-template-columns: 14px minmax(0, 220px) minmax(0, 1fr) auto;
  padding-top: 10px;
  padding-bottom: 10px;
}

.tls-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--ink-3);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.tls-btn:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  color: var(--ink);
}

.tls-btn--danger:hover {
  background: var(--error-soft);
  color: var(--error);
}
</style>
