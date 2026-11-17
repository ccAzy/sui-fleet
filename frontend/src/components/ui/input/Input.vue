<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

/**
 * 单行输入框。
 *
 * 视觉对齐 paper.css 里对 `.v-field` 的定制，而不是 shadcn 默认的灰白方块：
 *   surface 背景 + 1px rule-strong 边框 + 2px 圆角 + 聚焦转 accent。
 * 这样替换 Vuetify 的 v-text-field 时，页面观感不变。
 *
 * 支持 v-model。label / hint / error 由外层用 <Label> 和普通文本组合，
 * 保持与 shadcn 一致的单职责（不做浮动标签）。
 */
const props = defineProps<{
  modelValue?: string | number
  type?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  id?: string
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  'update:modelValue': [value: string]
}>()

function onInput(e: Event) {
  emits('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <input
    :id="props.id"
    :type="props.type ?? 'text'"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :readonly="props.readonly"
    :class="
      cn(
        'h-[38px] w-full rounded-[2px] px-2.5',
        'border border-[var(--rule-strong)] bg-[var(--surface)]',
        'text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-3)]',
        'outline-none transition-colors duration-150',
        'hover:border-[var(--rule-strong)]',
        'focus:border-[var(--accent)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'read-only:bg-[var(--surface-2)]',
        props.class,
      )
    "
    @input="onInput"
  />
</template>
