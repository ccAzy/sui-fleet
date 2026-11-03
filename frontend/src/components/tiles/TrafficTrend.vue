<template>
  <section class="sheet-block trend">
    <h3>
      {{ $t('main.trend.title') }} 
      <span class="trend-range">{{ days }}{{ $t('main.trend.unit') }}</span>
      <v-icon icon="mdi-refresh" size="12" class="trend-refresh" @click="load()"></v-icon>
    </h3>

    <div v-if="!bars.length" class="trend-empty">{{ $t('main.trend.empty') }}</div>
    <template v-else>
      <div class="trend-chart">
        <Bar :data="chartData" :options="chartOptions" :plugins="[valueLabels]" />
      </div>
      <div class="trend-total">
        ↓ {{ hz(totalDown) }} · ↑ {{ hz(totalUp) }}
      </div>
    </template>

    <template v-if="top.length">
      <div class="trend-sub">{{ $t('main.trend.top') }}</div>
      <div v-for="(t, i) in top" :key="t.tag" class="row-line trend-line">
        <span class="k">{{ i + 1 }}. <span class="trend-tag">{{ t.tag }}</span></span>
        <span class="v">{{ hz(t.up + t.down) }}</span>
      </div>
    </template>

    <template v-if="watch.length">
      <div class="trend-sub">{{ $t('main.trend.watch') }}</div>
      <div v-for="c in watch" :key="c.name" class="row-line trend-line">
        <span class="k">{{ c.name }}</span>
        <span class="v">
          <span v-if="c.volume > 0" :data-state="c.pct >= 100 ? 'error' : 'warn'">{{ c.pct }}%</span>
          <span v-if="c.expiry > 0">
            · {{ c.daysLeft <= 0 ? $t('main.trend.expired') : c.daysLeft + $t('main.trend.dleft') }}
          </span>
        </span>
      </div>
    </template>
  </section>
</template>

<script lang="ts" setup>
  import { onMounted, ref, computed } from 'vue'
  import { Bar } from 'vue-chartjs'
  import {
    Chart as ChartJS,
    BarElement,
    BarController,
    CategoryScale,
    LinearScale,
    Tooltip,
  } from 'chart.js'
  import HttpUtils from '@/plugins/httputil'
  import { useTheme } from 'vuetify'
  import { chartInk, chartGrid } from '@/plugins/chartTheme'

  ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

  // 数据来自 /api/usage-summary：usage 表按天聚合 + Top 客户端 + 需要关注的客户端
  const days = ref(7)
  const bars = ref<Array<{ d: string; up: number; down: number }>>([])
  const top = ref<Array<{ tag: string; up: number; down: number }>>([])
  const watch = ref<Array<{ name: string; pct: number; expiry: number; daysLeft: number; volume: number }>>([])

  const totalUp = computed(() => bars.value.reduce((a, b) => a + (b.up || 0), 0))
  const totalDown = computed(() => bars.value.reduce((a, b) => a + (b.down || 0), 0))

  const hz = (n: number) => {
    n = Number(n) || 0
    const u = ['B', 'K', 'M', 'G', 'T']
    let i = 0
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024
      i++
    }
    return `${n.toFixed(i ? 1 : 0)}${u[i]}`
  }

  // 把字节数压到 0-100 的纵轴，轴标签再换算回人类单位
  const theme = useTheme()
  const dark = computed(() => theme.current.value.dark)
  const scale = computed(() => {
    const max = Math.max(1, ...bars.value.map((b) => (b.up || 0) + (b.down || 0)))
    return { max, factor: max / 100 }
  })

  const chartData = computed(() => ({
    labels: bars.value.map((b) => String(b.d).slice(5)),
    datasets: [
      {
        label: 'down',
        data: bars.value.map((b) => (b.down || 0) / scale.value.factor),
        backgroundColor: 'rgba(120, 120, 120, 0.45)',
        borderWidth: 0,
        stack: 't',
      },
      {
        label: 'up',
        data: bars.value.map((b) => (b.up || 0) / scale.value.factor),
        backgroundColor: 'rgba(40, 40, 40, 0.75)',
        borderWidth: 0,
        stack: 't',
      },
    ],
  }))

  /**
   * 柱子顶上的数值标签。
   *
   * 原来只有 tooltip：想知道「前天到底用了多少」必须把鼠标挪上去，触屏上要长按，
   * 而「近 7 天流量」这个读数的意义就是扫一眼能读出每天的绝对值。所以把总量
   * 直接画在柱顶，tooltip 保留（它还能拆出上行/下行）。
   *
   * 画在 afterDatasetsDraw：此时坐标变换已经就绪，直接拿每根柱子的像素坐标，
   * 不用自己重算比例尺。
   */
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart: any) {
      const { ctx } = chart
      const totals = bars.value.map((b) => (b.up || 0) + (b.down || 0))
      const upMeta = chart.getDatasetMeta(chart.data.datasets.length - 1)
      if (!upMeta?.data?.length) return
      ctx.save()
      ctx.font = '600 10px ui-monospace, "Cascadia Mono", Consolas, monospace'
      ctx.fillStyle = chartInk(dark.value)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      upMeta.data.forEach((el: any, i: number) => {
        const v = totals[i] || 0
        if (v <= 0) return                       // 0 流量不画，免得顶上堆一排 0
        ctx.fillText(hz(v), el.x, Math.max(10, el.y - 3))
      })
      ctx.restore()
    },
  }

  const chartOptions = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const raw = (ctx.raw as number) * scale.value.factor
            return `${ctx.dataset.label === 'up' ? '↑' : '↓'} ${hz(raw)}`
          },
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: chartInk(dark.value), font: { size: 10 } } },
      y: {
        stacked: true,
        beginAtZero: true,
        max: 100,
        grid: { color: chartGrid(dark.value), drawTicks: false },
        border: { display: false },
        ticks: {
          stepSize: 25,
          color: chartInk(dark.value),
          font: { size: 10 },
          callback: (v: any) => hz(Number(v) * scale.value.factor),
        },
      },
    },
  }))

  async function load() {
    const msg = await HttpUtils.get('api/usage-summary', { days: days.value })
    if (!msg.success) return
    const obj = (msg.obj || {}) as any
    bars.value = obj.days || []
    top.value = obj.top || []
    watch.value = obj.watch || []
  }

  onMounted(load)
  defineExpose({ load })
</script>

<style scoped>
  .trend { margin-top: var(--s4, 16px); }
  .trend-range { font-size: var(--fs-sm, 12px); color: var(--ink-3, #8a8a8a); margin-inline-start: 6px; font-weight: 400; }
  .trend-refresh { margin-inline-start: 6px; cursor: pointer; opacity: 0.5; vertical-align: -1px; }
  .trend-refresh:hover { opacity: 1; }
  .trend-chart { height: 156px; margin: 8px 0 2px; }
  .trend-total { font-size: var(--fs-sm, 12px); color: var(--ink-3, #8a8a8a); text-align: end; }
  .trend-empty { font-size: var(--fs-sm, 12px); color: var(--ink-3, #8a8a8a); padding: 6px 0; }
  .trend-sub {
    margin-top: var(--s3, 12px);
    font-size: var(--fs-sm, 12px);
    color: var(--ink-3, #8a8a8a);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    padding-bottom: 2px;
  }
  .trend-line .k { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trend-tag { color: var(--ink, #222); }
</style>
