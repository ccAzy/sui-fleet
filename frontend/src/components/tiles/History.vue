<template>
  <LineChart v-if="loaded" :data="data" :options="<any>options" />
</template>

<script lang="ts">
/* eslint-disable vue/no-side-effects-in-computed-properties */
/* options1/optionsNet 是 Chart.js 的配置对象，不是响应式状态；
   这里设置的是刻度颜色与格式化回调，属于构造图表配置的必要动作，
   改成返回新对象会让 Chart.js 丢失配置引用、导致不重绘。 */
import { ref } from 'vue'
import { Line as LineChart } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Filler,
} from 'chart.js'
import { HumanReadable } from '@/plugins/utils'
import { chartInk, chartGrid } from '@/plugins/chartTheme'
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Filler
)
// 与全站同一套正文栈（原来写死 Vazirmatn，Windows 上不存在会回退到默认宋体）
ChartJS.defaults.font.family = '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif'
// 账簿上的曲线是一根线，不是坐标纸：细线、无点、无边框，只留几条极淡的横线
ChartJS.defaults.font.size = 10
ChartJS.defaults.color = 'rgba(107, 105, 97, 0.85)'
ChartJS.defaults.borderColor = 'rgba(128, 128, 128, 0.10)'
ChartJS.defaults.elements.point.radius = 0
ChartJS.defaults.elements.point.hoverRadius = 2
ChartJS.defaults.elements.line.borderWidth = 1.5
export default {
  components: {
    LineChart
  },
  props: ['tilesData','type'],
  data() {
    return {
      loaded: false,
      labels: new Array(20).fill(''),
      oldValues: <any>{net: {}, dio: {}},
      options1: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          tooltip: {
            enabled: false
          },
          legend: {
              display: false,
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { display: false },
          },
          y: {
            min: 0,
            // 不再固定 0-100：CPU 空闲时只有 0.x%，固定上限会让线完全贴在底部看不见。
            // suggestedMax 让 Chart.js 从小刻度开始，数据超过时自动放大。
            suggestedMax: 10,
            grid: {
              color: 'rgba(128, 128, 128, 0.10)',
              drawTicks: false,
            },
            border: { display: false },
            beginAtZero: true,
            ticks: {
                beginAtZero: true,
                steps: 10,
                stepValue: 5,
                max: 100
            }
          }
        }
      },
      optionsNet: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          tooltip: {
            enabled: false
          },
          legend: {
              display: false,
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { display: false },
          },
          y: {
            grid: {
              color: 'rgba(128, 128, 128, 0.10)',
              drawTicks: false,
            },
            border: { display: false },
            beginAtZero: true,
            ticks: {
              callback: (label:any, index: number) => { return parseInt(label).toString() },
              count: 10
            }
          }
        }
      },
      data: ref(<any>{})
    }
  },
  computed: {
    options() {
      // 主题变了要重算：Chart.js 的刻度和网格颜色来自这里的对象。
      // 之前没设置 tick 颜色，Chart.js 用默认 #666 —— 在深色纸面 #121211 上只有 3.0:1。
      const dark = this.$vuetify.theme.current.dark
      for (const o of [this.options1, this.optionsNet] as any[]) {
        const y = o?.scales?.y
        if (y?.ticks) y.ticks.color = chartInk(dark)
        if (y?.grid) y.grid.color = chartGrid(dark)
        const x = o?.scales?.x
        if (x?.ticks) x.ticks.color = chartInk(dark)
      }
      switch (this.$props.type){
        case "h-net":
          this.optionsNet.scales.y.ticks.callback = (label:any, index: number) => {
            return label == 0 ? "0" : HumanReadable.sizeFormat(label,0)
          }
          return this.optionsNet
        case "hp-net":
          this.optionsNet.scales.y.ticks.callback = (label:any, index: number) => {
            return label == 0 ? "0" : HumanReadable.packetFormat(label,0)
          }
          return this.optionsNet
        case "h-dio":
          this.optionsNet.scales.y.ticks.callback = (label:any, index: number) => {
            return label == 0 ? "0" : HumanReadable.sizeFormat(label,0)
          }
          return this.optionsNet
      }
      return this.options1
    }
  },
  methods: {
    updateData1(value1: number) {
      const newData = <number[]>[]
      if (this.data.datasets){
        newData.push(...this.data.datasets[0].data,value1)
      }
      if (newData.length>20) newData.shift()
      this.data = {
        labels: this.labels,
        datasets: [
          {
            label: '',
            backgroundColor: '#4a6f9c1f',
            borderColor: '#4a6f9ccc',
            fill: true,
            data: newData
          }
        ],
      }
      this.loaded = true
    },
    updateData2(value1: number, value2:number) {
      const newData1 = <number[]>[]
      const newData2 = <number[]>[]
      if (this.data.datasets){
        newData1.push(...this.data.datasets[0].data,value1)
        newData2.push(...this.data.datasets[1].data,value2)
      }
      if (newData1.length>20) newData1.shift()
      if (newData2.length>20) newData2.shift()
      this.data = {
        labels: this.labels,
        datasets: [
          {
            label: '',
            backgroundColor: '#4a6f9c1f',
            borderColor: '#4a6f9ccc',
            fill: true,
            data: newData1
          },
          {
            label: '',
            backgroundColor: 'rgba(0, 128, 0, 0.1)',
            borderColor: 'rgba(0, 128, 0,0.8)',
            fill: true,
            data: newData2
          }
        ],
      }
      this.loaded = true
    }
  },
  watch: {
    tilesData(v:any) {
      switch (this.$props.type) {
        case 'h-cpu':
          this.updateData1(v.cpu)
          break
        case 'h-mem':
          this.updateData1(v.mem.current*100/v.mem.total)
          break
        case 'h-net':
          if (this.oldValues.net.sent) {
            const downSpeed = (v.net.recv-this.oldValues.net.recv)/2  // Each 2 sec
            const upSpeed = (v.net.sent-this.oldValues.net.sent)/2  // Each 2 sec
            this.updateData2(upSpeed,downSpeed)
          }
          this.oldValues.net = v.net
          break
        case 'hp-net':
          if (this.oldValues.net.psent) {
            const downSpeed = (v.net.precv-this.oldValues.net.precv)/2  // Each 2 sec
            const upSpeed = (v.net.psent-this.oldValues.net.psent)/2  // Each 2 sec
            this.updateData2(upSpeed,downSpeed)
          }
          this.oldValues.net = v.net
          break
        case 'h-dio':
          if (!v.dio) break          // 节点不上报 dio 时安静跳过，别每 2 秒抛一次
          if (this.oldValues.dio?.read) {
            const downSpeed = (v.dio.read-this.oldValues.dio.read)/2  // Each 2 sec
            const upSpeed = (v.dio.write-this.oldValues.dio.write)/2  // Each 2 sec
            this.updateData2(upSpeed,downSpeed)
          }
          this.oldValues.dio = v.dio
          break
      }
    }
  }
}
</script>