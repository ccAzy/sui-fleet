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
        <div class="del-warn">{{ $t('server.delWarn') }}</div>
        <v-checkbox v-model="delModal.wipe" :label="$t('server.wipeNodes')" density="compact" hide-details color="error" class="mt-2" />
      </v-card-text>
      <v-card-actions>
        <v-btn color="error" variant="flat" @click="delServer()">{{ $t('yes') }}</v-btn>
        <v-btn variant="text" class="confirm-cancel" @click="delModal.visible = false">{{ $t('no') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- 移交主控：面板 → 本机执行器 → SSH 到目标机跑 promote.sh，本弹窗只负责看输出 -->
  <v-dialog v-model="promote.visible" max-width="680">
    <v-card :title="$t('server.promote')">
      <v-divider></v-divider>
      <v-card-text>
        <template v-if="!promote.available">
          <p class="promote-hint">{{ $t('server.promoteNoExecutor') }}</p>
        </template>
        <template v-else>
          <p class="promote-hint">{{ $t('server.promoteHint') }}</p>
          <v-select
            v-model="promote.target"
            :items="promote.targets"
            :label="$t('server.promoteTarget')"
            density="compact"
            variant="underlined"
            hide-details
            class="mb-3"
          />
          <div class="promote-actions">
            <v-btn size="small" variant="text" :disabled="promote.running || !promote.target" @click="runPromote(true)">
              {{ $t('server.promoteDry') }}
            </v-btn>
            <v-btn size="small" variant="flat" :disabled="promote.running || !promote.target" @click="runPromote(false)">
              {{ $t('server.promoteRun') }}
            </v-btn>
          </div>
          <pre v-if="promote.log" class="promote-log">{{ promote.log }}</pre>
          <p v-if="promote.done" class="promote-hint">{{ $t('server.promoteDone') }}</p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="promote.visible = false">{{ $t('actions.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- 聚合订阅：一个地址管全部节点，加/退节点自动增减 -->
  <v-dialog v-model="sub.visible" max-width="680">
    <v-card :title="$t('server.subAll')">
      <v-divider></v-divider>
      <v-card-text>
        <p v-if="!sub.ok" class="promote-hint">{{ $t('server.subUnavailable') }}</p>
        <template v-else>
          <p class="promote-hint">{{ $t('server.subHint') }}</p>
          <div v-for="row in subRows" :key="row.key" class="sub-row">
            <span class="sub-label">{{ row.label }}</span>
            <code class="sub-url">{{ row.url }}</code>
            <v-btn
              size="x-small"
              variant="text"
              :prepend-icon="sub.copied === row.key ? 'mdi-check' : 'mdi-content-copy'"
              @click="copySub(row)"
            >
              {{ sub.copied === row.key ? $t('server.subCopied') : $t('server.subCopy') }}
            </v-btn>
          </div>
          <p class="promote-hint mb-0">{{ $t('server.subNote') }}</p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="sub.visible = false">{{ $t('actions.close') }}</v-btn>
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
      <v-btn size="small" variant="text" class="toolbar-ghost" prepend-icon="mdi-link-variant" @click="openSub">
        {{ $t('server.subAll') }}
      </v-btn>
      <v-btn size="small" variant="text" class="toolbar-ghost" prepend-icon="mdi-swap-horizontal" @click="openPromote">
        {{ $t('server.promote') }}
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
        <span v-if="item.enabled === false" class="managing">· {{ $t('server.disabled') }}</span>
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
        <v-btn
          :icon="item.enabled === false ? 'mdi-power-plug-off' : 'mdi-power-plug'"
          size="x-small"
          variant="text"
          :color="item.enabled === false ? 'warning' : undefined"
          @click.stop="toggleEnabled(item)"
        >
          <v-icon />
          <v-tooltip activator="parent" location="top"
            :text="item.enabled === false ? $t('server.enable') : $t('server.disable')"></v-tooltip>
        </v-btn>
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
import { i18n } from '@/locales'
import { push } from 'notivue'

const router = useRouter()

const servers = computed((): any[] => Data().servers ?? [])

// ---- 移交主控：调 /api/ops/promote，这里只负责把逐行输出显示出来 ----
// 面板跑在 Cloudflare 上时 /api/ops/targets 会返回 available:false，界面直接说明原因，
// 不做假按钮（点了必然失败的东西不该存在）。
const promote = ref({
  visible: false,
  available: false,
  targets: <string[]>[],
  target: '',
  log: '',
  running: false,
  done: false,
})

const openPromote = async () => {
  promote.value = { ...promote.value, visible: true, log: '', done: false, running: false }
  const r = await HttpUtils.get('api/ops/targets')
  if (r.success) {
    promote.value.available = !!r.obj?.available
    promote.value.targets = r.obj?.targets ?? []
    promote.value.target = promote.value.target || (promote.value.targets[0] ?? '')
  }
}

const runPromote = async (dry: boolean) => {
  if (!promote.value.target || promote.value.running) return
  promote.value.running = true
  promote.value.done = false
  promote.value.log = (dry ? '… 正在体检（不改任何东西）' : '… 正在执行（会安装并启动面板）') + String.fromCharCode(10)
  try {
    const res = await fetch(
      `api/ops/promote?target=${encodeURIComponent(promote.value.target)}${dry ? '&dry=1' : ''}`,
      { method: 'POST', credentials: 'same-origin' },
    )
    promote.value.log = await res.text()
    promote.value.done = !dry && promote.value.log.includes('[DONE exit=0]')
  } catch (e) {
    promote.value.log = `请求失败：${String(e)}`
  } finally {
    promote.value.running = false
  }
}
// ---- 聚合订阅：客户端只存一个地址，加/退节点自动增减 ----
const sub = ref<{ visible: boolean, ok: boolean, urls: Record<string, string>, copied: string }>({
  visible: false, ok: false, urls: {}, copied: '',
})

const subRows = computed(() => [
  { key: 'clash', label: 'Clash / Mihomo', url: sub.value.urls.clash ?? '' },
  { key: 'singbox', label: 'sing-box', url: sub.value.urls.singbox ?? '' },
  { key: 'plain', label: 'Base64 通用', url: sub.value.urls.plain ?? '' },
])

const openSub = async () => {
  sub.value = { ...sub.value, visible: true, ok: false, copied: '' }
  const r = await HttpUtils.get('api/sub-info')
  if (r.success && r.obj?.ok) {
    sub.value = { ...sub.value, ok: true, urls: r.obj.urls ?? {} }
  }
}

const copySub = async (row: { key: string, url: string }) => {
  try {
    await navigator.clipboard.writeText(row.url)
    sub.value = { ...sub.value, copied: row.key }
    setTimeout(() => {
      if (sub.value.copied === row.key) sub.value = { ...sub.value, copied: '' }
    }, 1500)
  } catch {
    // 浏览器拒绝剪贴板时，URL 本身在弹窗里可以手动选中复制
  }
}

const currentServer = computed((): string => Data().currentServer)

const editModal = ref<{ visible: boolean, server: any }>({ visible: false, server: null })

// 删除确认改成全页唯一的 dialog。上一版是每行塞一个 v-overlay，
// 8 台机器就有 8 个浮层挂在 DOM 上，而且 contained 的 overlay 会被行高裁掉。
const delModal = ref<{ visible: boolean, item: any, index: number, wipe: boolean }>({
  visible: false, item: null, index: -1, wipe: false,
})

type ServerStatus = { state: 'idle' | 'testing' | 'online' | 'offline', latency?: number, age?: number, error?: string }
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
  // 这个数字是「距上次上报多少秒」，不是网络延迟——面板从不反连节点。
  // 原来拼成 `${latency} ms`，170 秒没上报会显示成 "170 ms"，纯属误导。
  if (s.state === 'online') return `↑${s.age ?? s.latency}s`
  if (s.state === 'offline') return 'offline'
  return '—'
}

// 刷新一次可达性：后端按 agent 最近上报时间判定，不反连节点。
// 启用/禁用节点：禁用后它不会成为「默认节点」，也不会进聚合订阅，但配置和客户端都还在。
const toggleEnabled = async (item: any) => {
  const next = item.enabled === false
  const r = await HttpUtils.post('api/nodes/' + item.id + '/enabled', { on: next ? '1' : '0' })
  if (!r.success) {
    push.error({ title: i18n.global.t('error'), message: r.msg || '', duration: 5000 })
    return
  }
  item.enabled = next
  // 拉一次全量，避免本地状态和后端不一致
  await Data().loadServers()
}

const testServer = async (item: any) => {
  statusMap.value = { ...statusMap.value, [item.id]: { state: 'testing' } }
  const r = await HttpUtils.get('api/testServer', { id: item.id })
  const o: any = r.obj || {}
  statusMap.value = {
    ...statusMap.value,
    [item.id]: o.online
      ? { state: 'online', latency: o.age ?? o.latency, age: o.age ?? o.latency }
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
/* 移交主控弹窗：日志区用等宽，长输出可滚动，不撑破弹窗 */
.promote-hint {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin: 0 0 10px;
}
.promote-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.promote-log {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.55;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 3px;
  padding: 10px 12px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
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

.del-warn {
  color: rgb(var(--v-theme-error));
  font-size: 13px;
  line-height: 1.6;
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

/* 聚合订阅弹窗：地址用等宽字体，允许换行，长 URL 不至于把弹窗撑破 */
.sub-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.sub-row:last-of-type {
  border-bottom: 0;
}

.sub-label {
  flex: 0 0 128px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.sub-url {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.5;
  word-break: break-all;
  user-select: all;
}
