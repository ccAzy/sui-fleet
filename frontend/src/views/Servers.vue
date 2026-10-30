<template>
  <ServerEdit
    v-model="editModal.visible"
    :visible="editModal.visible"
    :server="editModal.server"
    @close="closeEdit"
  />
  <v-dialog v-model="delModal.visible" max-width="360">
    <v-card :title="$t('actions.del')">
      <v-divider></v-divider>
      <v-card-text>
        <div class="del-name">{{ delModal.item?.name }}</div>
        {{ $t('confirm') }}
        <v-checkbox v-model="delModal.wipe" :label="$t('server.wipeNodes')" density="compact" hide-details color="error" class="mt-2" />
      </v-card-text>
      <v-card-actions>
        <v-btn color="error" variant="flat" @click="delServer()">{{ $t('yes') }}</v-btn>
        <v-btn variant="text" class="confirm-cancel" @click="delModal.visible = false">{{ $t('no') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- 工具栏：动作靠右，左侧只放一句数量；节点本身按账簿一行一台排下去 -->
  <div class="page-head">
    <span class="page-head-note">{{ servers.length }} {{ $t('pages.servers') }}</span>
    <div class="page-head-actions">
      <v-btn v-if="servers.length > 0" variant="text" size="small" class="toolbar-ghost" prepend-icon="mdi-restart" @click="bulkCommand('restart_core')">
        {{ $t('server.restartAll') }}
      </v-btn>
      <v-btn v-if="servers.length > 0" variant="text" size="small" class="toolbar-ghost" prepend-icon="mdi-download" @click="bulkUpdate">
        {{ $t('server.updateAll') }}
      </v-btn>
      <v-btn size="small" variant="outlined" prepend-icon="mdi-server-plus" @click="showEdit(null)">{{ $t('server.add') }}</v-btn>
    </div>
  </div>

  <div v-if="servers.length === 0" class="servers-empty">{{ $t('server.empty') }}</div>

  <div v-else class="ledger ledger--servers">
    <div
      v-for="(item, index) in servers"
      :key="item.id"
      class="ledger-row"
      :class="{ 'is-lead': currentServer === String(item.id) }"
    >
      <span class="ledger-mark" :data-state="markState(item)" aria-hidden="true"></span>

      <span class="ledger-name">
        {{ item.name }}
        <span v-if="currentServer === String(item.id)" class="managing">● {{ $t('server.managing') }}</span>
      </span>

      <span class="ledger-meta">
        <span class="mono">{{ item.url }}</span>
        <template v-if="item.remark"><span class="sep">·</span>{{ item.remark }}</template>
        <template v-if="item.kernel_ver"><span class="sep">·</span><span class="mono">sing-box {{ item.kernel_ver }}</span></template>
      </span>

      <span class="ledger-state" :data-state="markState(item)">
        <v-progress-circular v-if="st(item).state === 'testing'" size="10" width="1" indeterminate class="me-1" />
        {{ stateText(item) }}
      </span>

      <span class="ledger-actions">
        <v-btn icon="mdi-lan-pending" size="x-small" variant="text" @click.stop="testServer(item)">
          <v-icon />
          <v-tooltip activator="parent" location="top" :text="$t('server.test')"></v-tooltip>
        </v-btn>
        <v-btn icon="mdi-download" size="x-small" variant="text" @click.stop="updateNode(item)">
          <v-icon />
          <v-tooltip activator="parent" location="top" :text="$t('actions.update')"></v-tooltip>
        </v-btn>
        <v-btn icon="mdi-cog" size="x-small" variant="text" color="primary" @click.stop="manage(item)">
          <v-icon />
          <v-tooltip activator="parent" location="top" :text="$t('server.manage')"></v-tooltip>
        </v-btn>
        <v-btn icon="mdi-file-edit" size="x-small" variant="text" @click.stop="showEdit(item)">
          <v-icon />
          <v-tooltip activator="parent" location="top" :text="$t('actions.edit')"></v-tooltip>
        </v-btn>
        <v-btn icon="mdi-file-remove" size="x-small" variant="text" color="warning" @click.stop="askDelete(item, index)">
          <v-icon />
          <v-tooltip activator="parent" location="top" :text="$t('actions.del')"></v-tooltip>
        </v-btn>
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import Data from '@/store/modules/data'
import HttpUtils from '@/plugins/httputil'
import api from '@/plugins/api'
import ServerEdit from '@/layouts/modals/ServerEdit.vue'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const servers = computed((): any[] => Data().servers ?? [])
const currentServer = computed((): string => Data().currentServer)

const editModal = ref<{ visible: boolean, server: any }>({ visible: false, server: null })

// 删除确认改成全页唯一的 dialog。上一版是每行塞一个 v-overlay，
// 8 台机器就有 8 个浮层挂在 DOM 上，而且 contained 的 overlay 会被行高裁掉。
const delModal = ref<{ visible: boolean, item: any, index: number, wipe: boolean }>({
  visible: false, item: null, index: -1, wipe: false,
})

type ServerStatus = { state: 'idle' | 'testing' | 'online' | 'offline', latency?: number, error?: string }
const statusMap = ref<Record<string, ServerStatus>>({})
const st = (item: any): ServerStatus => statusMap.value[item.id] || { state: 'idle' }

const markState = (item: any) => {
  const s = st(item).state
  if (s === 'online') return 'up'
  if (s === 'offline') return 'error'
  return 'down'
}

const stateText = (item: any) => {
  const s = st(item)
  if (s.state === 'testing') return ''
  if (s.state === 'online') return `${s.latency} ms`
  if (s.state === 'offline') return 'offline'
  return '—'
}

// Probe a server's reachability + token through the backend (it calls the
// remote APIv2 and times the round-trip).
const testServer = async (item: any) => {
  statusMap.value = { ...statusMap.value, [item.id]: { state: 'testing' } }
  const r = await HttpUtils.get('api/testServer', { id: item.id })
  const o: any = r.obj || {}
  statusMap.value = {
    ...statusMap.value,
    [item.id]: o.online
      ? { state: 'online', latency: o.latency }
      : { state: 'offline', error: o.error },
  }
}
const testAll = () => servers.value.forEach(testServer)

// Auto-test on load and whenever the list changes (e.g. after add/edit).
watch(servers, () => testAll(), { immediate: true })

// 下发节点二进制（含内核）更新指令；HttpUtils 会自动弹成功/失败提示
const updateNode = async (item: any) => {
  await HttpUtils.post('api/nodes/' + item.id + '/update-agent', {})
}

const bulkCommand = async (kind: string) => {
  await HttpUtils.post('api/nodes/all/command', { kind })
}

const bulkUpdate = async () => {
  await HttpUtils.post('api/nodes/all/update-agent', {})
}

const showEdit = (server: any) => {
  editModal.value.server = server
  editModal.value.visible = true
}
const closeEdit = () => {
  editModal.value.visible = false
}

// Switch the panel to manage this server, then jump to its inbounds.
const manage = (item: any) => {
  Data().setCurrentServer(String(item.id))
  router.push('/inbounds')
}

// Delete every inbound on a remote server, talking to it directly via the proxy
// header so the local view isn't overwritten with the remote's data. Opt-in only.
const wipeRemoteNodes = async (id: string) => {
  const resp = await api.get('api/inbounds', { headers: { 'X-Remote-Server': id } })
  const inbounds: any[] = resp.data?.obj?.inbounds ?? []
  for (const ib of inbounds) {
    await api.post('api/save',
      { object: 'inbounds', action: 'del', data: JSON.stringify(ib.id) },
      { headers: { 'X-Remote-Server': id } })
  }
}

const askDelete = (item: any, index: number) => {
  delModal.value = { visible: true, item, index, wipe: false }
}

const delServer = async () => {
  const item = delModal.value.item
  if (!item) return
  if (delModal.value.wipe) {
    // If the server is unreachable we can't clear its nodes — drop the entry anyway.
    try { await wipeRemoteNodes(String(item.id)) } catch { /* ignore */ }
  }
  const success = await Data().save('servers', 'del', item.id)
  if (success) {
    // If we just removed the server we were managing, fall back to the local
    // panel so subsequent api/load calls aren't proxied to a gone remote.
    if (String(item.id) === Data().currentServer) Data().setCurrentServer('')
    delModal.value = { visible: false, item: null, index: -1, wipe: false }
  }
}
</script>

<style scoped>
/* 账簿行的五列版：状态与操作各占一列，操作 hover 才显形 */
.ledger--servers .ledger-row {
  grid-template-columns: 14px minmax(0, 1.1fr) minmax(0, 2.4fr) auto auto;
  align-items: center;
  padding-top: 10px;
  padding-bottom: 10px;
}

.ledger--servers .ledger-meta {
  line-height: 1.55;
}

.ledger-state {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 64px;
}

.ledger-actions {
  margin-left: var(--s2);
}

.servers-empty {
  padding: var(--s6) 0;
  color: var(--ink-3);
  font-size: var(--fs-sm);
}

.del-name {
  font-family: var(--serif);
  font-size: var(--fs-lg);
  margin-bottom: var(--s2);
}

@media (max-width: 900px) {
  .ledger--servers .ledger-row {
    grid-template-columns: 14px minmax(0, 1fr) auto;
  }

  .ledger--servers .ledger-meta,
  .ledger--servers .ledger-state {
    display: none;
  }
}
</style>
