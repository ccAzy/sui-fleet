<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { cn } from '@/lib/utils'

export interface SelectItem {
  title: string
  value: string | number
}

/**
 * 下拉选择 —— 用来替换 `<v-select :items>`。
 *
 * 视觉与 FormField 完全对齐（同一套边框、浮动标签、聚焦色），
 * 所以把 `v-select` + 外层的 `v-text-field` 混在一个表单里不会打架。
 *
 * 面板用 Teleport + fixed 定位，避免被弹窗/滚动容器的 overflow 裁掉；
 * 打开期间监听 scroll/resize 重新定位，视口下方空间不够时向上翻。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null
    items?: (string | SelectItem)[]
    label?: string
    placeholder?: string
    disabled?: boolean
    clearable?: boolean
    error?: string
    hint?: string
    id?: string
    class?: string
  }>(),
  { items: () => [], placeholder: '' },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
  clear: []
}>()

const uid = useId()
const selectId = computed(() => props.id ?? `sel-${uid}`)

const open = ref(false)
const focused = ref(false)
const activeIndex = ref(-1)
const triggerEl = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const flipUp = ref(false)

/** 统一成 {title,value}，兼容 `:items="['a','b']"` 的简写 */
const normalized = computed<SelectItem[]>(() =>
  props.items.map((it) =>
    typeof it === 'object' && it !== null
      ? { title: String(it.title ?? it.value ?? ''), value: it.value as string | number }
      : { title: String(it), value: it as string | number },
  ),
)

const selected = computed(() => normalized.value.find((it) => it.value === props.modelValue) ?? null)
const hasValue = computed(() => props.modelValue !== undefined && props.modelValue !== null && String(props.modelValue) !== '')
const floating = computed(() => focused.value || open.value || hasValue.value)

function measure() {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const spaceBelow = window.innerHeight - r.bottom
  const spaceAbove = r.top
  const wantUp = spaceBelow < 220 && spaceAbove > spaceBelow
  flipUp.value = wantUp
  panelStyle.value = {
    position: 'fixed',
    left: `${r.left}px`,
    width: `${r.width}px`,
    ...(wantUp
      ? { bottom: `${window.innerHeight - r.top + 4}px` }
      : { top: `${r.bottom + 4}px` }),
    'z-index': '3000',
  }
  if (!wantUp) delete panelStyle.value.bottom
  else delete panelStyle.value.top
}

function reposition() {
  if (open.value) measure()
}

function toggle() {
  if (props.disabled) return
  open.value ? close() : openPanel()
}

function openPanel() {
  open.value = true
  activeIndex.value = normalized.value.findIndex((it) => it.value === props.modelValue)
  measure()
  nextTick(() => {
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
  })
}

function close() {
  open.value = false
  activeIndex.value = -1
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
}

function pick(item: SelectItem) {
  emit('update:modelValue', item.value)
  close()
}

function clearValue(e: Event) {
  e.stopPropagation()
  emit('update:modelValue', null)
  emit('clear')
}

function move(delta: number) {
  if (!open.value) {
    openPanel()
    return
  }
  const max = normalized.value.length - 1
  if (max < 0) return
  let next = activeIndex.value + delta
  if (next < 0) next = max
  if (next > max) next = 0
  activeIndex.value = next
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      move(-1)
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (open.value && activeIndex.value >= 0) {
        const item = normalized.value[activeIndex.value]
        if (item) pick(item)
      } else {
        openPanel()
      }
      break
    case 'Escape':
      if (open.value) {
        e.preventDefault()
        close()
      }
      break
    case 'Tab':
      close()
      break
  }
}

/** 点击面板和触发器之外的地方关闭 */
function onDocPointerDown(e: PointerEvent) {
  const t = e.target as Node
  if (triggerEl.value?.contains(t)) return
  if ((t as Element)?.closest?.('[data-ui-select-panel]')) return
  close()
}

watch(open, (v) => {
  if (v) document.addEventListener('pointerdown', onDocPointerDown, true)
  else document.removeEventListener('pointerdown', onDocPointerDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <div :class="cn('w-full', props.class)">
    <div
      :id="selectId"
      ref="triggerEl"
      role="combobox"
      :aria-expanded="open"
      :aria-controls="`${selectId}-list`"
      aria-haspopup="listbox"
      :aria-disabled="props.disabled"
      :tabindex="props.disabled ? -1 : 0"
      :class="
        cn(
          'relative flex h-[40px] w-full cursor-pointer select-none items-center rounded-[2px] px-2.5',
          'border bg-[var(--surface)] text-[13px] outline-none transition-colors duration-150',
          props.error ? 'border-[var(--error)]' : open ? 'border-[var(--accent)]' : 'border-[var(--rule-strong)]',
          'focus-visible:border-[var(--accent)]',
          props.disabled && 'cursor-not-allowed bg-[var(--surface-2)] opacity-70',
        )
      "
      @click="toggle"
      @keydown="onKeydown"
      @focus="focused = true"
      @blur="focused = false"
    >
      <span :class="cn('truncate', hasValue ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]')">
        {{ selected?.title ?? props.placeholder }}
      </span>

      <span class="ml-auto flex items-center gap-1 pl-1">
        <button
          v-if="props.clearable && hasValue && !props.disabled"
          type="button"
          aria-label="clear"
          class="ui-reset grid h-4 w-4 place-items-center rounded-[2px] text-[var(--ink-3)] hover:text-[var(--ink)]"
          @click="clearValue"
        >
          <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
          </svg>
        </button>
        <svg
          viewBox="0 0 16 16"
          :class="cn('h-3 w-3 text-[var(--ink-3)] transition-transform duration-150', open && 'rotate-180')"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        >
          <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>

      <label
        v-if="props.label"
        :class="
          cn(
            'pointer-events-none absolute left-2 origin-left bg-[var(--surface)] px-1',
            'transition-all duration-150',
            floating ? '-top-[7px] text-[11px] leading-[14px]' : 'top-1/2 -translate-y-1/2 text-[13px] leading-none',
            props.error
              ? 'text-[var(--error)]'
              : open || focused
                ? 'text-[var(--accent)]'
                : 'text-[var(--ink-3)]',
            props.disabled && 'bg-[var(--surface-2)]',
          )
        "
      >
        {{ props.label }}
      </label>
    </div>

    <div
      v-if="props.error || props.hint"
      :class="cn('mt-0.5 min-h-[16px] text-[11px] leading-[16px]', props.error ? 'text-[var(--error)]' : 'text-[var(--ink-3)]')"
    >
      {{ props.error || props.hint }}
    </div>

    <Teleport to="body">
      <div
        v-if="open"
        data-ui-select-panel
        :id="`${selectId}-list`"
        role="listbox"
        :style="panelStyle"
        :class="
          cn(
            'max-h-[260px] overflow-y-auto rounded-[2px] p-1',
            'border border-[var(--rule-strong)] bg-[var(--surface)]',
            'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.22)]',
          )
        "
      >
        <p v-if="normalized.length === 0" class="px-2 py-1.5 text-[12px] text-[var(--ink-3)]">—</p>
        <button
          v-for="(item, i) in normalized"
          :key="String(item.value)"
          type="button"
          role="option"
          :aria-selected="item.value === props.modelValue"
          :class="
            cn(
              'ui-reset flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[13px]',
              'transition-colors duration-100',
              i === activeIndex ? 'bg-[var(--surface-2)]' : 'bg-transparent',
              item.value === props.modelValue ? 'text-[var(--ink)]' : 'text-[var(--ink-2)]',
            )
          "
          @mouseenter="activeIndex = i"
          @click="pick(item)"
        >
          <span class="w-3 shrink-0 text-[var(--accent)]">
            <svg v-if="item.value === props.modelValue" viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 8.5l3.2 3.2L13 5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="truncate">{{ item.title }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
