<template>
  <div class="sector-scatter-container">
    <div class="sector-scatter-header">
      <h3 class="sector-scatter-title">行业 Beta-Alpha 分布图（vs {{ indexName }}，{{ days }}日）</h3>
      <div class="sector-scatter-legend">
        <span class="legend-item"><span class="dot q1"></span>高α低β（优质防御）</span>
        <span class="legend-item"><span class="dot q2"></span>高α高β（优质进攻）</span>
        <span class="legend-item"><span class="dot q3"></span>低α低β（跑输防御）</span>
        <span class="legend-item"><span class="dot q4"></span>低α高β（跑输进攻）</span>
      </div>
    </div>

    <div ref="chartRef" class="sector-scatter-chart"></div>

    <div v-if="loading" class="sector-scatter-loading">⏳ 正在计算行业CAPM...</div>
    <div v-if="error" class="sector-scatter-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'

interface SectorData {
  ts_code: string
  name: string
  beta: number
  alpha: number
  alphaAnnual: number
  rSquared: number
  tValue: number
  significant: boolean
  annualVol?: number
  sharpe?: number
  tradingDays: number
  conclusion?: string
  error?: string
}

const props = defineProps<{
  sectors: SectorData[]
  indexName: string
  days: number
  loading?: boolean
  error?: string | null
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

// 过滤有效数据
const validSectors = computed(() => {
  return props.sectors.filter(s => !s.error && s.beta !== 0)
})

// 计算坐标范围
const xRange = computed(() => {
  if (validSectors.value.length === 0) return { min: 0, max: 2 }
  const betas = validSectors.value.map(s => s.beta)
  const min = Math.min(...betas, 0)
  const max = Math.max(...betas, 1.5)
  const padding = (max - min) * 0.1
  return { min: min - padding, max: max + padding }
})

const yRange = computed(() => {
  if (validSectors.value.length === 0) return { min: -0.5, max: 0.5 }
  const alphas = validSectors.value.map(s => s.alphaAnnual)
  const min = Math.min(...alphas, -0.3)
  const max = Math.max(...alphas, 0.3)
  const padding = (max - min) * 0.1
  return { min: min - padding, max: max + padding }
})

// 渲染图表
function renderChart() {
  if (!chartRef.value || validSectors.value.length === 0) return
  if (!chart) chart = echarts.init(chartRef.value)
  else chart.resize()

  const xr = xRange.value
  const yr = yRange.value

  // 按象限分类数据
  const q1Data: any[] = [] // 高α低β
  const q2Data: any[] = [] // 高α高β
  const q3Data: any[] = [] // 低α低β
  const q4Data: any[] = [] // 低α高β

  validSectors.value.forEach(s => {
    const item = {
      value: [s.beta, s.alphaAnnual],
      name: s.name,
      ts_code: s.ts_code,
      sector: s,
    }
    if (s.alphaAnnual >= 0 && s.beta <= 1) q1Data.push(item)
    else if (s.alphaAnnual >= 0 && s.beta > 1) q2Data.push(item)
    else if (s.alphaAnnual < 0 && s.beta <= 1) q3Data.push(item)
    else q4Data.push(item)
  })

  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const s = p.data.sector as SectorData
        return `<strong>${s.name}</strong><br/>` +
          `代码: ${s.ts_code}<br/>` +
          `β = ${s.beta.toFixed(3)}<br/>` +
          `α(年化) = ${(s.alphaAnnual * 100).toFixed(2)}%<br/>` +
          `R² = ${(s.rSquared * 100).toFixed(1)}%<br/>` +
          `t值 = ${s.tValue.toFixed(2)}<br/>` +
          `年化波动 = ${(s.annualVol ? s.annualVol * 100 : 0).toFixed(2)}%<br/>` +
          `Sharpe = ${s.sharpe?.toFixed(3) || '-'}<br/>` +
          `<small>${s.conclusion}</small>`
      },
    },
    grid: { left: 60, right: 40, top: 40, bottom: 50 },
    xAxis: {
      type: 'value',
      name: 'β (Beta)',
      nameLocation: 'middle',
      nameGap: 30,
      min: xr.min,
      max: xr.max,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      axisLabel: { color: '#888' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    yAxis: {
      type: 'value',
      name: 'α 年化',
      nameLocation: 'middle',
      nameGap: 40,
      min: yr.min,
      max: yr.max,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      axisLabel: {
        color: '#888',
        formatter: (v: number) => (v * 100).toFixed(0) + '%',
      },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      // 参考线 β=1
      {
        type: 'line',
        data: [[1, yr.min], [1, yr.max]],
        lineStyle: { color: 'rgba(255,255,255,0.15)', type: 'dashed', width: 1 },
        symbol: 'none',
        silent: true,
        z: 0,
      },
      // 参考线 α=0
      {
        type: 'line',
        data: [[xr.min, 0], [xr.max, 0]],
        lineStyle: { color: 'rgba(255,255,255,0.15)', type: 'dashed', width: 1 },
        symbol: 'none',
        silent: true,
        z: 0,
      },
      // Q1: 高α低β（优质防御）- 绿色
      {
        name: '优质防御',
        type: 'scatter',
        data: q1Data,
        symbolSize: 14,
        itemStyle: { color: '#22c55e', opacity: 0.85 },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => p.data.name.slice(0, 4),
          color: '#aaa',
          fontSize: 10,
        },
        emphasis: { scale: 1.5 },
        z: 2,
      },
      // Q2: 高α高β（优质进攻）- 青色
      {
        name: '优质进攻',
        type: 'scatter',
        data: q2Data,
        symbolSize: 14,
        itemStyle: { color: '#06b6d4', opacity: 0.85 },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => p.data.name.slice(0, 4),
          color: '#aaa',
          fontSize: 10,
        },
        emphasis: { scale: 1.5 },
        z: 2,
      },
      // Q3: 低α低β（跑输防御）- 红色
      {
        name: '跑输防御',
        type: 'scatter',
        data: q3Data,
        symbolSize: 14,
        itemStyle: { color: '#ef4444', opacity: 0.85 },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => p.data.name.slice(0, 4),
          color: '#aaa',
          fontSize: 10,
        },
        emphasis: { scale: 1.5 },
        z: 2,
      },
      // Q4: 低α高β（跑输进攻）- 橙色
      {
        name: '跑输进攻',
        type: 'scatter',
        data: q4Data,
        symbolSize: 14,
        itemStyle: { color: '#f97316', opacity: 0.85 },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => p.data.name.slice(0, 4),
          color: '#aaa',
          fontSize: 10,
        },
        emphasis: { scale: 1.5 },
        z: 2,
      },
    ],
  }, true)
}

// 监听数据变化
watch(() => props.sectors, () => {
  nextTick(() => renderChart())
}, { deep: true })

// 监听加载状态
watch(() => props.loading, (val) => {
  if (!val) nextTick(() => renderChart())
})

onMounted(() => {
  nextTick(() => renderChart())
})

onUnmounted(() => {
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.sector-scatter-container {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 20px;
}

.sector-scatter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.sector-scatter-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}

.sector-scatter-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dot.q1 { background: #22c55e; }
.dot.q2 { background: #06b6d4; }
.dot.q3 { background: #ef4444; }
.dot.q4 { background: #f97316; }

.sector-scatter-chart {
  width: 100%;
  height: 420px;
}

.sector-scatter-loading,
.sector-scatter-error {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.sector-scatter-error {
  color: var(--color-down);
}
</style>
