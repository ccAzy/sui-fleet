<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * 弹窗 —— 用来替换 `<v-dialog v-model="x" max-width="600">`。
 *
 * 用 reka-ui 的 Dialog 原语而不是自己撸：焦点陷阱、ESC 关闭、打开时锁定
 * 背景滚动、关闭后焦点归位这几件事它都做对了，手写很容易漏掉一环。
 * 视觉换成 paper 那套：纸面底、1px 墨线、2px 圆角、克制的投影。
 *
 * 用法：
 *   <Dialog v-model:open="show" title="新建入站">
 *     ...表单...
 *     <template #footer><Button @click="save">保存</Button></template>
 *   </Dialog>
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
    width?: string | number
    /** 点遮罩是否关闭，对齐 v-dialog 的 persistent 反义 */
    dismissible?: boolean
    class?: string
  }>(),
  { width: 560, dismissible: true },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const widthStyle = () => (typeof props.width === 'number' ? `${props.width}px` : props.width)
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[2000] bg-[rgba(26,26,25,0.32)] data-[state=open]:animate-in data-[state=closed]:animate-out"
      />
      <DialogContent
        :class="
          cn(
            'fixed left-1/2 top-1/2 z-[2001] -translate-x-1/2 -translate-y-1/2',
            'flex max-h-[85vh] flex-col overflow-hidden rounded-[2px]',
            'border border-[var(--rule-strong)] bg-[var(--surface)]',
            'shadow-[0_24px_60px_-20px_rgba(26,26,25,0.35)]',
            'focus:outline-none',
            props.class,
          )
        "
        :style="{ width: widthStyle() }"
        @pointer-down-outside="props.dismissible ? emit('update:open', false) : undefined"
        @escape-key-down="props.dismissible ? emit('update:open', false) : undefined"
      >
        <header
          v-if="props.title || $slots.header"
          class="flex shrink-0 items-start gap-3 border-b border-[var(--rule)] px-5 py-3.5"
        >
          <div class="min-w-0 flex-1">
            <slot name="header">
              <DialogTitle class="text-[15px] font-semibold text-[var(--ink)]" style="font-family: var(--serif)">
                {{ props.title }}
              </DialogTitle>
              <DialogDescription v-if="props.description" class="mt-0.5 text-[12px] text-[var(--ink-3)]">
                {{ props.description }}
              </DialogDescription>
            </slot>
          </div>
          <DialogClose
            v-if="props.dismissible"
            class="ui-reset grid h-6 w-6 shrink-0 place-items-center rounded-[2px] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            aria-label="close"
          >
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
            </svg>
          </DialogClose>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--rule)] px-5 py-3"
        >
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
