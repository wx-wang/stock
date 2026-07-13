<template>
  <Teleport to="body">
    <div class="popup-overlay" @click.self="$emit('close')">
      <div class="popup-container">
        <div class="popup-header">
          <h3 class="popup-title">{{ sectorName }} <span class="popup-code">{{ indexCode }}</span></h3>
          <button class="popup-close" @click="$emit('close')">✕</button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading" class="popup-loading">⏳ 正在计算趋势...</div>
        <div v-if="error" class="popup-error">⚠️ {{ error }}</div>

        <!-- 图表 -->
        <div ref="chartRef" class="popup-chart" v-show="!loading && !error && trend.length > 0"></div>

        <!-- 空数据 -->
        <div v-if="!loading && !error && trend.length === 0" class="popup-empty">
          暂无趋势数据
        </div>

        <!-- 图例说明 -->
        <div class="popup-legend" v-if="trend.length > 0">
          <span class="legend-line alpha">━ Alpha（年化）</span>
          <span class="legend-line beta">━ Beta</span>
          <span class="legend-info">窗口: {{ windowDays }}日 · 共 {{ trend.length }} 个快照</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'

interface TrendPoint {
  date: string
  alpha: number
  alphaAnnual: number
  beta: number
  rSquared: number
}

const props = defineProps<{
  indexCode: string
  sectorName: string
  days?: number
}>()
defineEmits<{ close: [] }>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const loading = ref(false)
const error = ref<string | null>(null)
const trend = ref<TrendPoint[]>([])
const windowDays = ref(60)

async function fetchTrend() {
  loading.value = true
  error.value = null
  try {
    const resp = await fetch(
      `/api/sectors/capm-trend?index_code=${props.indexCode}&window=${props.days || 60}&days=150&base_index=000300.SH`
    )
    const json = await resp.json()
    if (!json.success) { error.value = json.error; return }
    trend.value = json.data.trend
    windowDays.value = json.data.windowDays
    nextTick(() => renderChart())
  } catch (e: any) { error.value = e.message } finally { loading.value = false }
}

function renderChart() {
  if (!chartRef.value || trend.value.length === 0) return
  if (!chart) chart = echarts.init(chartRef.value)
  else chart.resize()

  const dates = trend.value.map(p => {
    const d = p.date
    return d.slice(4, 6) + '/' + d.slice(6)  // YYYYMMDD → MM/DD
  })
  const alphas = trend.value.map(p => p.alphaAnnual)
  const betas = trend.value.map(p => p.beta)

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const date = trend.value[params[0]?.dataIndex]?.date || ''
        const fmtDate = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6)
        let html = `<div style="font-weight:600;margin-bottom:4px;">${fmtDate}</div>`
        for (const p of params) {
          if (p.seriesName === 'Alpha(年化)') {
            html += `${p.marker} Alpha(年化): <b>${(p.value * 100).toFixed(2)}%</b><br/>`
          } else {
            html += `${p.marker} Beta: <b>${Number(p.value).toFixed(3)}</b><br/>`
          }
        }
        return html
      },
    },
    legend: { data: ['Alpha(年化)', 'Beta'], top: 5, textStyle: { color: '#888', fontSize: 12 } },
    grid: { left: 55, right: 55, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: '#888', fontSize: 10, interval: Math.floor(dates.length / 8) },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Alpha(年化)',
        nameTextStyle: { color: '#22c55e', fontSize: 11 },
        axisLabel: { color: '#888', fontSize: 11, formatter: (v: number) => (v * 100).toFixed(0) + '%' },
        splitLine: { lineStyle: { color: 'rgba(216,205,187,0.45)' } },
      },
      {
        type: 'value',
        name: 'Beta',
        nameTextStyle: { color: '#3370ff', fontSize: 11 },
        axisLabel: { color: '#888', fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Alpha(年化)',
        type: 'line',
        data: alphas,
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#22c55e', width: 2 },
        itemStyle: { color: '#22c55e' },
        markLine: {
          silent: true,
          data: [{ yAxis: 0, lineStyle: { color: 'rgba(216,205,187,0.7)', type: 'dashed' } }],
        },
      },
      {
        name: 'Beta',
        type: 'line',
        data: betas,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#3370ff', width: 2 },
        itemStyle: { color: '#3370ff' },
        markLine: {
          silent: true,
          data: [{ yAxis: 1, lineStyle: { color: 'rgba(216,205,187,0.7)', type: 'dashed' } }],
        },
      },
    ],
  }, true)
}

watch(() => props.indexCode, () => {
  if (props.indexCode) fetchTrend()
}, { immediate: true })

onUnmounted(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.popup-container {
  background: var(--bg-card, #1a1a2e);
  border: 1px solid var(--border-color, #2a2a4a);
  border-radius: 12px;
  width: 700px;
  max-width: 95vw;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #2a2a4a);
}

.popup-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}

.popup-code {
  font-size: 12px;
  color: var(--text-secondary, #888);
  font-family: monospace;
  font-weight: 400;
  margin-left: 8px;
}

.popup-close {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
}

.popup-close:hover {
  background: rgba(69, 107, 143, 0.12);
  color: var(--color-accent);
}

.popup-loading,
.popup-error,
.popup-empty {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-secondary, #888);
}

.popup-error {
  color: var(--color-down, #ef4444);
}

.popup-chart {
  width: 100%;
  height: 340px;
  flex-shrink: 0;
}

.popup-legend {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 20px 16px;
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.legend-line {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.legend-line.alpha { color: #22c55e; }
.legend-line.beta { color: #3370ff; }

.legend-info {
  margin-left: auto;
  font-size: 11px;
}
</style>
