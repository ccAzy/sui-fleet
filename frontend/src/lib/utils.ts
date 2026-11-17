import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn-vue 的标准工具函数：合并 class 并去重冲突的 utility。
 * twMerge 负责「后写的覆盖先写的」，clsx 负责条件拼接。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
