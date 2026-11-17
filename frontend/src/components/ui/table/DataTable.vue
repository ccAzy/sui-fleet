<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { cn } from '@/lib/utils'

export interface TableHeader {
  title?: string
  /** 列键，同时是 slot 名（`#cell-<key>`） */
  key: string
  /** v-data-table 把它叫 value，兼容写法 */
  value?: string
  width?: string | number
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
}

/**
 * 数据表格 —— 用来替换 `<v-data-table>`。
 *
 * 只覆盖项目里真正在用的那部分：固定列定义 + 单元格插槽 + 可选分页。
 * v-data-table 的 `show-expand`、`mobile` 响应式卡片这类重功能没有搬，
 * 需要时保留原组件即可（两套可以并存）。
 *
 * 插槽命名对齐 v-data-table，方便逐行替换：
 *   <template #cell-dateTime="{ item }">   ≈   <template v-slot:item.dateTime="{ item }">
 */
const props = withDefaults(
  defineProps<{
    headers: TableHeader[]
    items: Record<string, any>[]
    itemsPerPage?: number
    noDataText?: string
    density?: 'compact' | 'default'
    itemValue?: string
    loading?: boolean
    class?: string
  }>(),
  { itemsPerPage: 0, noDataText: '—', density: 'compact' },
)

const page = ref(1)

const keyOf = (h: TableHeader) => h.key ?? h.value ?? ''

const totalPages = computed(() =>
  props.itemsPerPage > 0 ? Math.max(1, Math.ceil(props.items.length / props.itemsPerPage)) : 1,
)

const paged = computed(() => {
  if (props.itemsPerPage <= 0) return props.items
  const start = (page.value - 1) * props.itemsPerPage
  return props.items.slice(start, start + props.itemsPerPage)
})

const rangeLabel = computed(() => {
  if (props.itemsPerPage <= 0 || props.items.length === 0) return `${props.items.length}`
  const start = (page.value - 1) * props.itemsPerPage + 1
  const end = Math.min(page.value * props.itemsPerPage, props.items.length)
  return `${start}–${end} / ${props.items.length}`
})

watch(
  () => props.items.length,
  () => {
    if (page.value > totalPages.value) page.value = totalPages.value
  },
)

const cellPad = computed(() => (props.density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2.5'))
</script>

<template>
  <div :class="cn('w-full overflow-hidden rounded-[2px] border border-[var(--rule)]', props.class)">
    <div class="w-full overflow-x-auto">
      <table class="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr class="border-b border-[var(--rule-strong)] bg-[var(--surface-2)]">
            <th
              v-for="h in props.headers"
              :key="keyOf(h)"
              :style="h.width ? { width: typeof h.width === 'number' ? `${h.width}px` : h.width } : undefined"
              :class="
                cn(
                  cellPad,
                  'whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ink-3)]',
                  h.align === 'right' && 'text-right',
                  h.align === 'center' && 'text-center',
                )
              "
            >
              {{ h.title ?? '' }}
            </th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="(row, i) in paged"
            :key="props.itemValue ? row[props.itemValue] : i"
            class="border-b border-[var(--rule)] transition-colors last:border-0 hover:bg-[var(--surface-2)]"
          >
            <td
              v-for="h in props.headers"
              :key="keyOf(h)"
              :class="cn(cellPad, 'align-middle text-[var(--ink-2)]', h.align === 'right' && 'text-right', h.align === 'center' && 'text-center')"
            >
              <slot :name="`cell-${keyOf(h)}`" :item="row" :value="row[keyOf(h)]" :index="i">
                {{ row[keyOf(h)] ?? '' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="props.items.length === 0 || props.itemsPerPage > 0"
      class="flex items-center justify-between gap-3 border-t border-[var(--rule)] px-3 py-1.5 text-[11px] text-[var(--ink-3)]"
    >
      <span>
        <template v-if="props.items.length === 0">{{ props.noDataText }}</template>
        <template v-else>{{ rangeLabel }}</template>
      </span>

      <span v-if="props.itemsPerPage > 0 && totalPages > 1" class="flex items-center gap-1">
        <button
          type="button"
          :disabled="page <= 1"
          class="ui-reset rounded-[2px] px-1.5 py-0.5 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-35 disabled:hover:bg-transparent"
          @click="page--"
        >
          ‹
        </button>
        <span class="tabular-nums">{{ page }} / {{ totalPages }}</span>
        <button
          type="button"
          :disabled="page >= totalPages"
          class="ui-reset rounded-[2px] px-1.5 py-0.5 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-35 disabled:hover:bg-transparent"
          @click="page++"
        >
          ›
        </button>
      </span>
    </div>
  </div>
</template>
