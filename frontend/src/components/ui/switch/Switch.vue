<script setup lang="ts">
import { useId } from 'vue'
import { cn } from '@/lib/utils'

/**
 * 开关。
 *
 * 视觉取「账簿」风格：轨道不用高饱和色，选中态就是墨色，
 * 与 DESIGN.md 里「颜色只做三件事」一致（分层 / 选中 / 异常）。
 *
 * 标签两种写法都支持：`label="开启"` 或默认插槽。
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
    :class="cn('inline-flex cursor-pointer items-center gap-2.5 select-none', props.disabled && 'cursor-not-allowed opacity-55', props.class)"
  >
    <input
      :id="id"
      type="checkbox"
      class="vu-switch relative m-0 h-[18px] w-[32px] shrink-0 cursor-pointer appearance-none rounded-full border border-[var(--rule-strong)] bg-[var(--surface-2)] transition-colors duration-150 checked:border-[var(--ink)] checked:bg-[var(--ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed"
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
/* 滑块：营造「纸面上的小圆点」，未选中贴左，选中滑到右 */
.vu-switch::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--rule-strong);
  transform: translateY(-50%);
  transition:
    left 160ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 160ms ease,
    border-color 160ms ease;
}

/* 32 - 12 - 2 = 18，贴着右边留 2px */
.vu-switch:checked::after {
  left: 18px;
  background: var(--paper);
  border-color: var(--paper);
}
</style>
