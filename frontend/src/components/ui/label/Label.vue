<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

/**
 * 表单标签。
 * 对应 DESIGN.md 的 label 排版：12px、ink-2、字距略开。
 */
const props = defineProps<{
  for?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <label
    :for="props.for"
    :class="
      cn(
        'block text-[12px] font-normal tracking-[0.02em] text-[var(--ink-2)]',
        props.class,
      )
    "
  >
    <slot />
  </label>
</template>
