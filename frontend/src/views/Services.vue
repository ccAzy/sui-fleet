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

  <!-- 工具条：右对齐 + 一条细线收口（DESIGN.md「列表页的统一收口」） -->
  <div class="page-toolbar mb-3 flex items-center justify-end gap-2 border-b border-[var(--rule-strong)] pb-2">
    <button
      type="button"
      class="ui-reset inline-flex items-center gap-1.5 rounded-[2px] px-2 py-1 text-[12px] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
      @click="showModal(0)"
    >
      <Plus class="h-3.5 w-3.5" />
      {{ $t('actions.add') }}
    </button>
  </div>

  <div v-if="!services.length" class="list-empty">{{ $t('emptyList') }}</div>

  <!--
    账簿式名录（DESIGN.md 的「标志性动作」）：
    这是一份同类对象清单，不是卡片墙。四列固定——状态墨点、名称（衬线）、
    参数（等宽 + · 分隔）、操作（默认隐形，hover/聚焦才出现）。
    原来这里是 v-card 网格，每个服务一个框，和站点其余列表页不是同一套语言。
  -->
  <div v-else class="obs-card svc-panel">
    <div class="svc-panel-head">
      <span class="svc-panel-title">{{ $t('pages.services') }}</span>
      <span class="svc-panel-count">{{ services.length }}</span>
    </div>
    <div class="ledger svc-ledger">
    <div v-for="item in services" :key="item.tag" class="ledger-row">
      <span class="ledger-mark" :data-state="item.tls_id > 0 ? 'up' : 'down'" aria-hidden="true"></span>

      <span class="ledger-name" :title="item.tag">{{ item.tag }}</span>

      <span class="ledger-meta">
        <span class="mono">:{{ item.listen_port }}</span>
        <span class="sep">·</span>{{ item.type }}
        <span class="sep">·</span>{{ item.tls_id > 0 ? 'TLS' : 'plain' }}
        <template v-if="item.listen">
          <span class="sep">·</span><span class="mono" :title="item.listen">{{ item.listen }}</span>
        </template>
      </span>

      <div class="ledger-actions">
        <button
          type="button"
          class="ui-reset grid h-6 w-6 place-items-center rounded-[2px] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          :title="$t('actions.edit')"
          :aria-label="$t('actions.edit')"
          @click.stop="showModal(item.id)"
        >
          <Pencil class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="ui-reset grid h-6 w-6 place-items-center rounded-[2px] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--error)]"
          :title="$t('actions.del')"
          :aria-label="$t('actions.del')"
          @click.stop="askDelete(item)"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
        </div>
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

<style scoped>
/* 服务页：卡片容器的表头 + 账簿行对齐 Obsidian 的圆角与间距 */
.svc-panel {
  margin-top: 2px;
}

.svc-panel-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--rule);
}

.svc-panel-title {
  font-family: var(--serif);
  font-size: 14.5px;
  letter-spacing: 0.01em;
  color: var(--ink);
}

.svc-panel-count {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink-3);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  padding: 1px 6px;
  border-radius: 5px;
}

.svc-ledger {
  border-top: 0;
  margin-top: 0;
  padding: 0 16px;
}

/* 行高与 hover 竖条：和设计稿的列表一致 */
.svc-ledger :deep(.ledger-row) {
  position: relative;
  /* 名称列限宽，参数紧跟其后——原来是 1.4fr / 2fr 平分，
     在宽屏上会把名称和参数甩到屏幕两端，中间空一大片 */
  grid-template-columns: 14px minmax(0, 240px) minmax(0, 1fr) auto;
  padding-top: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--rule);
}

.svc-ledger :deep(.ledger-row:last-child) {
  border-bottom: 0;
}

.svc-ledger :deep(.ledger-row)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
  opacity: 0;
  transition: opacity 0.15s ease;
}

@media (hover: hover) and (pointer: fine) {
  .svc-ledger :deep(.ledger-row:hover)::before {
    opacity: 1;
  }
}

.svc-ledger :deep(.ledger-name) {
  font-size: 13px;
}

.svc-ledger :deep(.ledger-meta) {
  font-size: 11.5px;
}
</style>
