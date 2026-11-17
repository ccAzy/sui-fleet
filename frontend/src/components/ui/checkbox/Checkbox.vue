<script setup lang="ts">
import { useId } from 'vue'
import { cn } from '@/lib/utils'

/**
 * 复选框。
 *
 * 用原生 input[type=checkbox]（外观清空后自绘），不用 reka-ui：
 * 原生元素自带键盘操作、表单提交、labels 关联，这里只需要视觉。
 * 勾是用伪元素画的（Tailwind 做伪元素勾很绕），其余结构走 utility。
 *
 * 标签两种写法都支持：`label="启用"` 或默认插槽。
 */
const props = defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
  class?: string
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const id = useId()
</script>

<template>
  <label
    :for="id"
    :class="cn('inline-flex cursor-pointer items-center gap-2 select-none', props.disabled && 'cursor-not-allowed opacity-55', props.class)"
  >
    <input
      :id="id"
      type="checkbox"
      class="vu-checkbox relative m-0 h-[15px] w-[15px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-[var(--rule-strong)] bg-[var(--surface)] transition-colors duration-150 checked:border-[var(--ink)] checked:bg-[var(--ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed"
      :checked="props.modelValue"
      :disabled="props.disabled"
      @change="emits('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="props.label || $slots.default" class="text-[13px] leading-[1.5] text-[var(--ink)]">
      <slot>{{ props.label }}</slot>
    </span>
  </label>
</template>

<style scoped>
/* 勾：选中后在墨底上画一个白色对勾（相对 input 自身定位） */
.vu-checkbox:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 2px;
  width: 4.5px;
  height: 8px;
  border: solid var(--paper);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}
</style>
