<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { cn } from '@/lib/utils'

/**
 * 带浮动标签的输入框 —— 用来一比一替换 `<v-text-field variant="outlined" density="compact">`。
 *
 * 为什么不是 shadcn 标准的「标签在上方独立一行」：
 * 项目里 262 个表单字段大多是 compact 密度，标签改成独立一行后每个字段
 * 会多出约 20px，规则页和协议表单会长出一大截。浮动标签是这套设计已有的语言。
 *
 * 行为对齐 Vuetify：没有焦点且没有值时，标签落在输入框中间（当占位符用）；
 * 聚焦或有值时浮到边框上。边框用「上边框走 label 底下」的方式留缺口。
 */
const props = defineProps<{
  modelValue?: string | number
  label?: string
  type?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  error?: string
  hint?: string
  id?: string
  class?: string
}>()

const emits = defineEmits<{
  'update:modelValue': [value: string]
}>()

const uid = useId()
const inputId = computed(() => props.id ?? `ff-${uid}`)
const focused = ref(false)

const hasValue = computed(() => {
  const v = props.modelValue
  return v !== undefined && v !== null && String(v).length > 0
})

/** 标签浮起：聚焦或有值 */
const floating = computed(() => focused.value || hasValue.value)
</script>

<template>
  <div :class="cn('w-full', props.class)">
    <div class="relative">
      <input
        :id="inputId"
        :type="props.type ?? 'text'"
        :value="props.modelValue"
        :placeholder="floating ? props.placeholder : undefined"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :aria-invalid="!!props.error"
        :aria-describedby="props.error || props.hint ? `${inputId}-msg` : undefined"
        :class="
          cn(
            'peer h-[40px] w-full rounded-[2px] px-2.5',
            'border bg-[var(--surface)] text-[13px] text-[var(--ink)]',
            'outline-none transition-colors duration-150',
            props.error ? 'border-[var(--error)]' : 'border-[var(--rule-strong)]',
            'focus:border-[var(--accent)]',
            'disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:opacity-70',
          )
        "
        @input="emits('update:modelValue', ($event.target as HTMLInputElement).value)"
        @focus="focused = true"
        @blur="focused = false"
      />

      <label
        v-if="props.label"
        :for="inputId"
        :class="
          cn(
            'pointer-events-none absolute left-2 origin-left bg-[var(--surface)] px-1',
            'transition-all duration-150',
            floating
              ? '-top-[7px] text-[11px] leading-[14px]'
              : 'top-1/2 -translate-y-1/2 text-[13px] leading-none',
            props.error ? 'text-[var(--error)]' : focused ? 'text-[var(--accent)]' : 'text-[var(--ink-3)]',
            props.disabled && 'bg-[var(--surface-2)]',
          )
        "
      >
        {{ props.label }}
      </label>
    </div>

    <div
      v-if="props.error || props.hint"
      :id="`${inputId}-msg`"
      :class="cn('mt-0.5 min-h-[16px] text-[11px] leading-[16px]', props.error ? 'text-[var(--error)]' : 'text-[var(--ink-3)]')"
    >
      {{ props.error || props.hint }}
    </div>
  </div>
</template>
