<template>
  <ServiceVue
    v-model="modal.visible"
    :visible="modal.visible"
    :id="modal.id"
    :data="modal.data"
    :inTags="inTags"
    :tsTags="tsTags"
    :ssTags="ssTags"
    :tlsConfigs="tlsConfigs"
    @close="closeModal"
  />

  <!-- 工具栏 -->
  <div class="page-toolbar mb-4 flex items-center justify-between gap-3">
    <Button size="sm" @click="showModal(0)">
      <Plus class="mr-1.5 h-3.5 w-3.5" />
      {{ $t('actions.add') }}
    </Button>
  </div>

  <!-- 空状态 -->
  <div
    v-if="!services.length"
    class="list-empty rounded-[2px] border border-dashed border-[var(--rule-strong)] py-14 text-center text-[13px] text-[var(--ink-3)]"
  >
    {{ $t('emptyList') }}
  </div>

  <!-- 服务卡片 -->
  <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
    <div
      v-for="item in services"
      :key="item.tag"
      class="flex min-w-0 flex-col rounded-[2px] border border-[var(--rule)] bg-[var(--surface)] transition-colors duration-150 hover:border-[var(--rule-strong)]"
    >
      <div class="min-w-0 px-3 pt-2.5">
        <h3 class="truncate text-[13px] font-semibold text-[var(--ink)]" style="font-family: var(--serif)" :title="item.tag">
          {{ item.tag }}
        </h3>
        <p class="mt-0.5 truncate text-[11px] uppercase tracking-[0.06em] text-[var(--ink-3)]">
          {{ item.type }}
        </p>
      </div>

      <dl class="mt-2 space-y-0.5 px-3 pb-2.5 text-[12px]">
        <div class="flex items-baseline gap-2">
          <dt class="shrink-0 text-[var(--ink-3)]">{{ $t('in.addr') }}</dt>
          <dd class="min-w-0 truncate text-right text-[var(--ink-2)]" :title="item.listen">{{ item.listen }}</dd>
        </div>
        <div class="flex items-baseline gap-2">
          <dt class="shrink-0 text-[var(--ink-3)]">{{ $t('in.port') }}</dt>
          <dd class="ml-auto tabular-nums text-[var(--ink-2)]">{{ item.listen_port }}</dd>
        </div>
        <div class="flex items-baseline gap-2">
          <dt class="shrink-0 text-[var(--ink-3)]">{{ $t('objects.tls') }}</dt>
          <dd class="ml-auto" :class="item.tls_id > 0 ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'">
            {{ item.tls_id > 0 ? $t('enable') : $t('disable') }}
          </dd>
        </div>
      </dl>

      <div class="mt-auto flex items-center gap-1 border-t border-[var(--rule)] px-1.5 py-1">
        <button
          type="button"
          class="ui-reset grid h-6 w-6 place-items-center rounded-[2px] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          :title="$t('actions.edit')"
          :aria-label="$t('actions.edit')"
          @click="showModal(item.id)"
        >
          <Pencil class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="ui-reset grid h-6 w-6 place-items-center rounded-[2px] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--error)]"
          :title="$t('actions.del')"
          :aria-label="$t('actions.del')"
          @click="askDelete(item)"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>

  <Dialog v-model:open="delOpen" :title="$t('actions.del')" :width="360">
    <p class="text-[13px] leading-relaxed text-[var(--ink-2)]">
      {{ $t('confirm') }}
    </p>
    <p v-if="delTarget" class="mt-1.5 truncate text-[12px] text-[var(--ink-3)]">{{ delTarget.tag }}</p>
    <template #footer>
      <Button variant="ghost" size="sm" class="confirm-cancel" @click="delOpen = false">{{ $t('no') }}</Button>
      <Button variant="destructive" size="sm" @click="doDelete">{{ $t('yes') }}</Button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import Data from '@/store/modules/data'
import type { Srv } from '@/types/services'
import ServiceVue from '@/layouts/modals/Service.vue'

const services = computed((): Srv[] => {
  return Data().services as Srv[]
})

const tsTags = computed((): any[] => {
  return Data().endpoints?.filter((o: any) => o.type == 'tailscale')?.map((o: any) => o.tag)
})

const ssTags = computed((): any[] => {
  return Data().inbounds?.filter((o: any) => o.type == 'shadowsocks' && !o.users)?.map((o: any) => o.tag)
})

const inTags = computed((): any[] => {
  return [
    ...(Data().inbounds?.map((o: any) => o.tag).filter((t) => t != null) ?? []),
    ...(Data().endpoints?.filter((e: any) => e.listen_port > 0).map((e: any) => e.tag) ?? []),
  ]
})

const tlsConfigs = computed((): any[] => {
  return Data().tlsConfigs as any[]
})

const modal = ref({
  visible: false,
  id: 0,
  data: '',
})

/** 删除确认：只记一个目标，不再为每张卡片维护一个 overlay 开关 */
const delOpen = ref(false)
const delTarget = ref<Srv | null>(null)

const showModal = (id: number) => {
  modal.value.id = id
  modal.value.data = id == 0 ? '' : JSON.stringify(services.value.findLast((o) => o.id == id))
  modal.value.visible = true
}

const closeModal = () => {
  modal.value.visible = false
}

const askDelete = (item: Srv) => {
  delTarget.value = item
  delOpen.value = true
}

const doDelete = async () => {
  const item = delTarget.value
  if (!item) return
  const success = await Data().save('services', 'del', item.tag)
  if (success) {
    delOpen.value = false
    delTarget.value = null
  }
}
</script>
