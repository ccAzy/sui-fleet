<template>
  <InboundVue 
    v-model="modal.visible"
    :visible="modal.visible"
    :id="modal.id"
    :inTags="inTags"
    :tlsConfigs="tlsConfigs"
    @close="closeModal"
  />
  <Stats
    v-model="stats.visible"
    :visible="stats.visible"
    :resource="stats.resource"
    :tag="stats.tag"
    @close="closeStats"
  />
  <QuickTemplate
    v-model="templateModal"
    :visible="templateModal"
    @close="closeTemplate"
  />
  <ExportLinks
    v-model="exportModal"
    :visible="exportModal"
    @close="exportModal = false"
  />
  <QrCode
    v-model="qrcode.visible"
    :visible="qrcode.visible"
    :id="qrcode.id"
    @close="qrcode.visible = false"
  />
  <v-dialog v-model="clearConfirm" width="380">
    <v-card class="rounded-lg" :title="$t('quickTemplate.clearAll')">
      <v-divider></v-divider>
      <v-card-text>{{ $t('quickTemplate.clearAllConfirm') }}</v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn variant="text" class="confirm-cancel" @click="clearConfirm = false">{{ $t('no') }}</v-btn>
        <v-btn color="error" variant="flat" :loading="clearLoading" @click="delAllInbounds">{{ $t('yes') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="picker.visible" width="320">
    <v-card class="rounded-lg" :title="$t('pages.clients')">
      <v-divider></v-divider>
      <v-list density="compact" nav>
        <v-list-item v-for="c in picker.clients" :key="c.id" link @click="pickClient(c.id)">
          <template v-slot:prepend><v-icon icon="mdi-qrcode"></v-icon></template>
          <v-list-item-title>{{ c.name }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </v-dialog>
  <v-row>
    <v-col cols="12" class="page-toolbar">
      <v-btn color="primary" class="toolbar-primary" @click="showModal(0)">{{ $t('actions.add') }}</v-btn>
      <v-btn variant="text" class="toolbar-ghost" prepend-icon="mdi-flash" @click="templateModal = true">
        {{ $t('quickTemplate.btn') }}
      </v-btn>
      <v-btn variant="text" class="toolbar-ghost" prepend-icon="mdi-export-variant" @click="exportModal = true">
        {{ $t('exportLinks.btn') }}
      </v-btn>
      <v-btn v-if="inbounds.length > 0" variant="text" class="toolbar-ghost toolbar-danger" prepend-icon="mdi-delete-sweep" :loading="clearLoading" @click="clearConfirm = true">
        {{ $t('quickTemplate.clearAll') }}
      </v-btn>
    </v-col>
  </v-row>
  <div class="ledger">
    <div v-if="!inbounds.length" class="list-empty">{{ $t('emptyList') }}</div>
    <div
      v-for="(item, index) in <any[]>inbounds"
      :key="item.tag"
      class="ledger-row"
    >
      <span class="ledger-mark" :data-state="onlines.includes(item.tag) ? 'up' : 'down'"></span>

      <span class="ledger-name">{{ item.tag }}</span>

      <span class="ledger-meta">
        <span class="mono">{{ fmtAddr(item) }}</span> · {{ item.type }} · {{ item.tls_id > 0 ? 'TLS' : 'plain' }} ·
        <span class="mono" :title="(item.users || []).join(', ')">{{ (item.users || []).length }}</span> 用户<template
          v-if="exitOf[item.tag]"
        > · {{ $t('relay.exitVia', { out: exitOf[item.tag] }) }}</template>
      </span>

      <div class="ledger-actions">
        <v-btn icon size="x-small" @click="showModal(item.id)">
          <v-icon size="14">mdi-pencil-outline</v-icon>
          <v-tooltip activator="parent" location="top" :text="$t('actions.edit')"></v-tooltip>
        </v-btn>
        <v-btn icon size="x-small" @click="delIndex = index; delDialog = true">
          <v-icon size="14">mdi-delete-outline</v-icon>
          <v-tooltip activator="parent" location="top" :text="$t('actions.del')"></v-tooltip>
        </v-btn>
        <v-btn icon size="x-small" :loading="cloneLoading" @click="clone(item.id)">
          <v-icon size="14">mdi-content-duplicate</v-icon>
          <v-tooltip activator="parent" location="top" :text="$t('actions.clone')"></v-tooltip>
        </v-btn>
        <v-btn v-if="item.users && item.users.length > 0" icon size="x-small" @click="showInboundQr(item)">
          <v-icon size="14">mdi-qrcode</v-icon>
          <v-tooltip activator="parent" location="top" :text="$t('client.links')"></v-tooltip>
        </v-btn>
        <v-btn v-if="Data().enableTraffic" icon size="x-small" @click="showStats(item.tag)">
          <v-icon size="14">mdi-chart-line</v-icon>
          <v-tooltip activator="parent" location="top" :text="$t('stats.graphTitle')"></v-tooltip>
        </v-btn>
      </div>
    </div>
  </div>

  <v-dialog v-model="delDialog" width="320">
    <v-card :title="$t('actions.del')">
      <v-divider></v-divider>
      <v-card-text>{{ $t('confirm') }}</v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn variant="text" @click="delDialog = false">{{ $t('no') }}</v-btn>
        <v-btn color="error" variant="flat" @click="confirmDelInbound">{{ $t('yes') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import Data from '@/store/modules/data'
import InboundVue from '@/layouts/modals/Inbound.vue'
import QuickTemplate from '@/layouts/modals/QuickTemplate.vue'
import QrCode from '@/layouts/modals/QrCode.vue'
import ExportLinks from '@/layouts/modals/ExportLinks.vue'
import Stats from '@/layouts/modals/Stats.vue'
import { Config } from '@/types/config'
import { computed, ref } from 'vue'
import { createInbound, Inbound } from '@/types/inbounds'
import RandomUtil from '@/plugins/randomUtil'
import { inboundOwners } from '@/plugins/relayUtil'

const appConfig = computed((): Config => {
  return <Config> Data().config
})

// inbound tag -> landing it is routed to (relay rules). Shown on the card so a
// node that now exits via a landing doesn't look like an ordinary direct node.
const exitOf = computed((): Record<string, string> => inboundOwners((Data().config as any)?.route?.rules || []))

const inbounds = computed((): Inbound[] => {
  return <Inbound[]> Data().inbounds
})

const tlsConfigs = computed((): any[] => {
  return <any[]> Data().tlsConfigs
})

const inTags = computed((): string[] => {
  return [...inbounds.value?.map(i => i.tag), ...Data().endpoints?.filter((e:any) => e.listen_port > 0).map((e:any) => e.tag)]
})

const onlines = computed(() => {
  return Data().onlines.inbound?? []
})

const modal = ref({
  visible: false,
  id: 0,
})

const templateModal = ref(false)
const closeTemplate = () => {
  templateModal.value = false
}

const exportModal = ref(false)

const clearConfirm = ref(false)
const clearLoading = ref(false)
const delAllInbounds = async () => {
  clearLoading.value = true
  const tags = inbounds.value.map(i => i.tag)
  for (const tag of tags) {
    await Data().save("inbounds", "del", tag)
  }
  clearLoading.value = false
  clearConfirm.value = false
}

const qrcode = ref({
  visible: false,
  id: 0,
})

// QR access straight from an inbound card. One client -> show its QR directly;
// several -> let the user pick which one.
const picker = ref({
  visible: false,
  clients: <any[]>[],
})
const clientsOf = (item: any): any[] => {
  return Data().clients.filter((c: any) => Array.isArray(c.inbounds) && c.inbounds.includes(item.id))
}
const showInboundQr = (item: any) => {
  const cls = clientsOf(item)
  if (cls.length === 0) return
  if (cls.length === 1) {
    qrcode.value.id = cls[0].id
    qrcode.value.visible = true
    return
  }
  picker.value.clients = cls
  picker.value.visible = true
}
const pickClient = (id: number) => {
  picker.value.visible = false
  qrcode.value.id = id
  qrcode.value.visible = true
}

// listen 常见是 "::"（IPv6 通配），直接和端口拼会显示成「:::46250」
const fmtAddr = (item: any) => {
  const host = String(item.listen ?? '')
  if (!host || host === '::' || host === '0.0.0.0') return `:${item.listen_port}`
  return `${host}:${item.listen_port}`
}

const delDialog = ref(false)
const delIndex = ref(-1)

const confirmDelInbound = async () => {
  const item = (<any[]>inbounds.value)[delIndex.value]
  delDialog.value = false
  if (item) await delInbound(item.id)
}


const showModal = (id: number) => {
  modal.value.id = id
  modal.value.visible = true
}
const closeModal = () => {
  modal.value.visible = false
}

const delInbound = async (id: number) => {
  const index = inbounds.value.findIndex(i => i.id == id)
  if (index < 0) return
  const tag = inbounds.value[index].tag
  await Data().save("inbounds", "del", tag)
}

let cloneLoading = ref(false)

const clone = async (id: number) => {
  cloneLoading.value = true
  const inboundArray = await Data().loadInbounds([id])
  const inbound = inboundArray[0]
  let newTag = inbound.type + "-" + RandomUtil.randomSeq(3)
  const newInbound = createInbound(inbound.type, { ...inbound,
    id: 0,
    tag: newTag,
    listen_port: RandomUtil.randomIntRange(10000, 60000),
  })
  await Data().save("inbounds", "new", newInbound)
  cloneLoading.value = false
}

const stats = ref({
  visible: false,
  resource: "inbound",
  tag: "",
})

const showStats = (tag: string) => {
  stats.value.tag = tag
  stats.value.visible = true
}
const closeStats = () => {
  stats.value.visible = false
}
</script>