<script lang="ts" setup>
import { HumanReadable } from '@/plugins/utils'
import { computed } from 'vue'

/**
 * 读数格（metre）。
 *
 * 上一版是三段半圆仪表盘：它的形状来自仪表盘模板，而且半圆里除了数字没有别的
 * 信息，8 台机器里 7 台恒为 0 的时候，三个空半圆把版面撑得像坏了。
 * 同一份数据落在账簿上应该是一个数 + 一把刻度尺：数字用等宽字对齐，
 * 细条只表达「占了几成」，下面的小字给出分母。
 */
const props = defineProps({
  tilesData: <any>{},
  type: String,
})

const data = computed(() => {
  const d = props.tilesData
  if (!d.mem && !d.cpu) return { value: '-', percent: 0, foot: '', level: '' }
  switch (props.type) {
    case 'g-cpu':
      // 保留一位小数：Math.ceil 会把 0.4% 显示成 1%，看着像卡住了
      return metre(d.cpu, 100, Number(d.cpu ?? 0).toFixed(1) + '%')
    case 'g-mem':
      return metre(d.mem)
    case 'g-dsk':
      return metre(d.dsk)
    case 'g-swp':
      return metre(d.swp)
  }
  return { value: '-', percent: 0, foot: '', level: '' }
})

const fmt = (n: number) => {
  const [num, unit] = HumanReadable.sizeFormat(n, 0).split(' ')
  return { num, unit: unit ?? '' }
}

/** 有分母的读数：主数字是已用量，脚注是分母与占比 */
const metre = (d: any, total = 0, text?: string) => {
  if (!d && text === undefined) return { value: '-', percent: 0, foot: '', level: '' }
  const percent = text === undefined ? (d.total > 0 ? Math.ceil((d.current * 100) / d.total) : 0) : clamp(Number(d))
  if (text !== undefined) {
    return { value: text, percent: clamp(Number(d)), foot: '', level: level(clamp(Number(d))) }
  }
  const used = fmt(d.current)
  const all = fmt(d.total)
  const sameUnit = used.unit === all.unit
  return {
    value: `${used.num}<sup>${used.unit}</sup>`,
    percent: clamp(percent),
    foot: `of ${all.num}${sameUnit ? '' : ' ' + all.unit} · ${clamp(percent)}%`,
    level: level(clamp(percent)),
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
const level = (n: number) => (n > 90 ? 'error' : n > 70 ? 'warn' : '')
</script>

<template>
  <div class="metre">
    <div class="metre-label">{{ $t(type === 'g-cpu' ? 'main.gauge.cpu' : type === 'g-mem' ? 'main.gauge.mem' : type === 'g-dsk' ? 'main.gauge.dsk' : 'main.gauge.swp') }}</div>
    <div class="metre-value" v-html="data.value"></div>
    <div class="metre-track">
      <div class="metre-fill" :style="{ width: data.percent + '%' }" :data-level="data.level"></div>
    </div>
    <div class="metre-foot">{{ data.foot || '&nbsp;' }}</div>
  </div>
</template>
