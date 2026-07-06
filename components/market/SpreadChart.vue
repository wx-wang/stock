<template>
  <div v-if="history && history.length > 0" class="spread-chart-container">
    <div ref="chartRef" class="chart-area"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, onUnmounted } from 'vue'
import * as echarts from 'echarts'

interface MonthPoint {
  date: string
  ep: number
  bond10y: number
  spread: number
  pe: number
}

const props = defineProps<{
  history: MonthPoint[]
  thresholds: { opportunity: number; overvalued: number; max: number; min: number }
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function buildChart() {
  if (!chartRef.value || !props.history.length) return
  if (!chart) {
    chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
  }

  const dates = props.history.map(h => {
    const m = h.date.slice(4, 6)
    const y = h.date.slice(2, 4)
    return `${y}/${m}`
  })

  const oppLine = props.thresholds.opportunity
  const ovrLine = props.thresholds.overvalued

  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(14,18,28,0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#c0c8d4', fontSize: 12 },
      formatter(params: any) {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) {
          html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>`
          html += `${p.seriesName}: <b>${p.value}%</b><br/>`
        }
        return html
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#8b8fa3', fontSize: 11 },
      itemWidth: 16, itemHeight: 3,
      data: ['股债利差', 'E/P', '10Y国债'],
    },
    grid: { top: 10, right: 20, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#6b7280', fontSize: 10,
        interval: Math.max(1, Math.floor(dates.length / 8) - 1),
      },
    },
    yAxis: {
      type: 'value',
      name: '%',
      nameTextStyle: { color: '#6b7280', fontSize: 10 },
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      {
        name: '股债利差',
        type: 'line',
        data: props.history.map(h => h.spread),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#4CAF50', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(76,175,80,0.25)' },
            { offset: 1, color: 'rgba(76,175,80,0.01)' },
          ]),
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#4CAF50', width: 1, opacity: 0.6 },
          label: { color: '#4CAF50', fontSize: 10, formatter: '机会 {c}' },
          data: [{ yAxis: oppLine, label: { formatter: `机会 ${oppLine}%` } }],
        },
      },
      {
        name: 'E/P',
        type: 'line',
        data: props.history.map(h => h.ep),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#FF5722', width: 1.5, opacity: 0.8 },
      },
      {
        name: '10Y国债',
        type: 'line',
        data: props.history.map(h => h.bond10y),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#42A5F5', width: 1.5, opacity: 0.8 },
      },
    ],
    visualMap: ovrLine > 0 ? {
      show: false,
      dimension: 1,
      pieces: [
        { gt: oppLine, color: 'rgba(76,175,80,0.08)' },
        { lt: ovrLine, color: 'rgba(244,67,54,0.06)' },
        { color: 'rgba(255,193,7,0.03)' },
      ],
      seriesIndex: 0,
    } : undefined,
  }

  chart.setOption(option, true)
}

onMounted(() => { nextTick(buildChart) })
watch(() => props.history, () => { nextTick(buildChart) }, { deep: true })

onUnmounted(() => {
  chart?.dispose()
  chart = null
})

const resizeObserver = typeof window !== 'undefined'
  ? new ResizeObserver(() => { chart?.resize() })
  : null

watch(chartRef, (el) => {
  if (el && resizeObserver) resizeObserver.observe(el)
  else if (resizeObserver) resizeObserver.disconnect()
})
</script>

<style scoped>
.spread-chart-container {
  width: 100%;
}
.chart-area {
  width: 100%;
  height: 320px;
}
@media (max-width: 480px) {
  .chart-area { height: 240px; }
}
</style>
