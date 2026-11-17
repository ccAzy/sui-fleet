<template>
  <AdminModal 
    v-model="editModal.visible"
    :visible="editModal.visible"
    :user="editModal.user"
    @close="closeEditModal"
    @save="saveEditModal"
  />
  <ChangeModal 
    v-model="changesModal.visible"
    :visible="changesModal.visible"
    :admins="users.map((u:any) => u.username)"
    :actor="changesModal.actor"
    @close="closeChangesModal"
  />
  <TokenModal 
    v-model="tokenModal.visible"
    :visible="tokenModal.visible"
    @close="closeTokenModal"
  />
  <v-row>
    <v-col cols="12" class="page-toolbar">
      <v-btn color="primary" @click="showChangesModal('')" style="margin: 0 5px;">{{ $t('admin.changes') }}</v-btn>
      <v-btn color="primary" @click="showTokenModal()">{{ $t('admin.api.token') }}</v-btn>
    </v-col>
  </v-row>
  <v-row>
    <div class="adm-ledger">
      <div v-for="item in <any[]>users" :key="item.id" class="ledger-row">
        <span class="ledger-mark" data-state="up" aria-hidden="true"></span>
        <span class="ledger-name" :title="item.username">{{ item.username }}</span>
        <span class="ledger-meta">
          {{ $t('admin.lastLogin') }}
          <span class="sep">·</span><span class="mono">{{ item.loginDate || '-' }}</span>
          <span class="sep">·</span><span class="mono">{{ item.loginTime || '-' }}</span>
          <template v-if="item.ip">
            <span class="sep">·</span><span class="mono">{{ item.ip }}</span>
          </template>
        </span>
        <div class="ledger-actions">
          <button type="button" class="ui-reset adm-btn" :title="$t('actions.edit')" @click="showEditModal(item)">
            <v-icon icon="mdi-account-edit" size="16" />
          </button>
          <button type="button" class="ui-reset adm-btn" :title="$t('admin.changes')" @click="showChangesModal(item.username)">
            <v-icon icon="mdi-list-box-outline" size="16" />
          </button>
        </div>
      </div>
    </div>
  </v-row>
</template>

<script lang="ts" setup>
import AdminModal from '@/layouts/modals/Admin.vue'
import ChangeModal  from '@/layouts/modals/Changes.vue'
import TokenModal from '@/layouts/modals/Token.vue'
import { i18n } from '@/locales'
import HttpUtils from '@/plugins/httputil'
import { Ref, ref, inject, onMounted } from 'vue'

const loading:Ref = inject('loading')?? ref(false)

const users = ref(<any[]>[])

onMounted(async () => {
  loading.value = true
  await loadData()
  loading.value = false
})

const loadData = async () => {
  loading.value = true
  const msg = await HttpUtils.get('api/users')
  loading.value = false
  if (msg.success) {
    msg.obj.forEach((u:any) => {
      const lastLogin = u.lastLogin.split(" ")
      const localLastLogin = lastLogin.length > 2 ? dateFormatted(Date.parse(lastLogin[0] + " " + lastLogin[1])) : "- -"
      const loginDateTime = localLastLogin.split(" ")
      users.value.push({
        id: u.id,
        username: u.username,
        loginDate: loginDateTime[0],
        loginTime: loginDateTime[1],
        ip: lastLogin[2]?? "-",
      })
    })
  }
}

const dateFormatted = (dt: number): string => {
  const locale = i18n.global.locale.value.replace('zh', 'zh-')
  const date = new Date(dt)
  return date.toLocaleString(locale)
}

const editModal = ref({
  visible: false,
  user: {},
})

const showEditModal = (user: any) => {
  editModal.value.user = user
  editModal.value.visible = true
}
const closeEditModal = () => {
  editModal.value.visible = false
  editModal.value.user = {}
}
const saveEditModal = async (data:any) => {
  loading.value=true
  const response = await HttpUtils.post('api/changePass',data)
  if(response.success){
    setTimeout(() => {
      loading.value=false
      editModal.value.visible = false
    }, 500)
  } else {
    loading.value=false
  }
}

const changesModal = ref({
  visible: false,
  actor: '',
})
const showChangesModal = (actor: string) => {
  changesModal.value.actor = actor
  changesModal.value.visible = true
}
const closeChangesModal = () => {
  changesModal.value.visible = false
  changesModal.value.actor = ''
}

const tokenModal = ref({
  visible: false,
})
const showTokenModal = () => {
  tokenModal.value.visible = true
}
const closeTokenModal = () => {
  tokenModal.value.visible = false
}
</script>
<style scoped>
/* 管理员页：卡片墙 → 账簿名录 */
.adm-ledger {
  border: 1px solid var(--card-line);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  padding: 0 16px;
  overflow: hidden;
  width: 100%;
}

.adm-ledger :deep(.ledger-row) {
  grid-template-columns: 14px minmax(0, 220px) minmax(0, 1fr) auto;
  padding-top: 10px;
  padding-bottom: 10px;
}

.adm-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--ink-3);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.adm-btn:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  color: var(--ink);
}
</style>
