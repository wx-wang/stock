<template>
  <div v-if="history && history.length >= 2" ref="containerRef" class="spread-chart">
    <div ref="chartRef" class="chart-inner"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, onUnmounted } from 'vue'

interface MonthPoint { date: string; ep: number; bond10y: number; spread: number; pe: number }

const props = defineProps<{
  history: MonthPoint[]
  thresholds: { opportunity: number; overvalued: number; max: number; min: number }
}>()

const chartRef = ref<HTMLDivElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
let chart: any = null

async function initChart() {
  if (!chartRef.value || props.history.length < 2) return

  // 确保 DOM 已渲染且有尺寸
  await nextTick()
  await new Promise(r => setTimeout(r, 50))

  const el = chartRef.value
  if (el.clientWidth === 0 || el.clientHeight === 0) {
    // 容器不可见，稍后重试
    setTimeout(initChart, 200)
    return
  }

  try {
    const echarts = await import('echarts').then(m => m.default || m)

    if (chart) chart.dispose()
    chart = echarts.init(el, undefined, { renderer: 'canvas' })

    const dates = props.history.map(h => h.date.slice(2, 6).replace(/(\d{2})(\d{2})/, '$1/$2'))
    const oppLine = props.thresholds.opportunity

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(14,18,28,0.95)',
        borderColor: 'rgba(255,255,255,0.08)',
        textStyle: { color: '#c8d0dc', fontSize: 12 },
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#8b8fa3', fontSize: 11 },
        itemWidth: 16, itemHeight: 3,
        data: ['股债利差', '盈利收益率E/P', '10年国债'],
      },
      grid: { top: 12, right: 24, bottom: 36, left: 56 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisTick: { show: false },
        axisLabel: { color: '#6b7280', fontSize: 10, interval: Math.max(1, Math.floor(dates.length / 8)) },
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
            color: new (await import('echarts').then(m => m.graphic || (m as any).default?.graphic)).LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(76,175,80,0.2)' },
              { offset: 1, color: 'rgba(76,175,80,0.01)' },
            ]),
          },
          markLine: oppLine > 0 ? {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#4CAF50', width: 1, opacity: 0.5 },
            label: { color: '#4CAF50', fontSize: 10 },
            data: [{ yAxis: oppLine, label: { formatter: `机会区 ${oppLine}%` } }],
          } : undefined,
        },
        {
          name: '盈利收益率E/P',
          type: 'line',
          data: props.history.map(h => h.ep),
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#FF5722', width: 1.5, opacity: 0.85 },
        },
        {
          name: '10年国债',
          type: 'line',
          data: props.history.map(h => h.bond10y),
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#42A5F5', width: 1.5, opacity: 0.85 },
        },
      ],
    }, true)
  } catch (e: any) {
    console.error('[SpreadChart] init failed:', e.message)
  }
}

onMounted(() => { nextTick(() => setTimeout(initChart, 100)) })
watch(() => props.history, () => { nextTick(initChart) }, { deep: true })
onUnmounted(() => { chart?.dispose(); chart = null })

// 窗口 resize
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => chart?.resize?.())
}
</script>

<style scoped>
.spread-chart {
  width: 100%;
  margin-top: 8px;
}
.chart-inner {
  width: 100%;
  height: 340px;
}
</style>
