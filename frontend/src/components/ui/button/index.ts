import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Button 的样式变体。
 *
 * 与 Vuetify 的 v-btn 并存，不替换任何现有页面——先在新增/重写的地方用。
 *
 * `ink` 变体对齐 Login.vue 里既有的 .login-submit（墨色实心 + 1px 描边 + 2px 圆角），
 * 因为 DESIGN.md 里「主操作」有两种语义：
 *   - accent（墨靛 #2c4a6e）：选中态 / 次级主操作
 *   - ink（墨 #1a1a19）：页面级唯一的主行动（如提交登录）
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[2px]',
    'font-medium transition-[opacity,background-color,color,border-color] duration-150',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:ring-[var(--ring)]',
    'disabled:pointer-events-none disabled:opacity-55',
  ].join(' '),
  {
    variants: {
      variant: {
        // 默认主操作：墨底纸字，等同设计稿里的「提交」按钮
        default: 'bg-[var(--ink)] text-[var(--paper)] [border:1px_solid_var(--ink)] hover:opacity-[0.88]',
        // 次主操作：墨靛（accent）用于「选中 / 当前项」语义
        accent: 'bg-[var(--accent)] text-[var(--surface)] [border:1px_solid_var(--accent)] hover:opacity-[0.9]',
        outline:
          'bg-transparent text-[var(--ink)] [border:1px_solid_var(--rule-strong)] hover:bg-[var(--surface-2)]',
        ghost: 'bg-transparent text-[var(--ink-2)] [border:1px_solid_transparent] hover:bg-[var(--surface-2)]',
        destructive: 'bg-[var(--error)] text-[var(--surface)] [border:1px_solid_var(--error)] hover:opacity-90',
        link: 'bg-transparent text-[var(--accent)] underline-offset-4 hover:underline [border:0]',
      },
      size: {
        sm: 'h-8 px-3 text-[12px]',
        default: 'h-[40px] px-4 text-[13px]',
        lg: 'h-11 px-6 text-[14px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
