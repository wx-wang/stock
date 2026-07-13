<!-- MarketCrowdingGauge.vue — 大盘拥挤度温度计 + 30日历史曲线 -->
<template>
  <div class="mkt-crowding card">
    <div class="mkt-header">
      <h3>🌡️ 大盘拥挤度</h3>
      <span class="mkt-sub">成交集中度 — 前5%个股成交额 / 全市场</span>
      <button class="btn btn-sm" @click="refresh" :disabled="loading" style="margin-left:auto;">🔄</button>
    </div>

    <div v-if="loading && !data" class="mkt-loading">加载中...</div>
    <div v-else-if="error" class="mkt-error">{{ error }}</div>

    <template v-else-if="data">
      <!-- 温度计 + 大数字 -->
      <div class="mkt-gauge-row">
        <div class="mkt-gauge">
          <svg viewBox="0 0 60 200" class="gauge-svg">
            <!-- 背景条 -->
            <rect x="22" y="20" width="16" height="160" rx="8" fill="rgba(216,205,187,0.55)" />

            <!-- 色段 -->
            <rect x="22" y="20" width="16" height="24" rx="8" fill="#C94B3D" opacity="0.8" />   <!-- 50+ -->
            <rect x="22" y="44" width="16" height="16" rx="0" fill="#F0A030" opacity="0.8" />    <!-- 40-50 -->
            <rect x="22" y="60" width="16" height="16" rx="0" fill="#F5C842" opacity="0.8" />    <!-- 30-40 -->
            <rect x="22" y="76" width="16" height="36" rx="0" fill="#2D8B6F" opacity="0.8" />    <!-- 20-30 -->
            <rect x="22" y="112" width="16" height="36" rx="0" fill="#456B8F" opacity="0.8" />   <!-- <20 -->

            <!-- 当前水位 -->
            <rect x="20" y="12" width="20" height="6" rx="3"
              :fill="data.latest.color"
              :y="gaugeY" />
          </svg>
          <div class="gauge-labels">
            <span style="color:#C94B3D;">50%</span>
            <span style="color:#F0A030;">40%</span>
            <span style="color:#F5C842;">30%</span>
            <span style="color:#2D8B6F;">20%</span>
          </div>
        </div>

        <div class="mkt-value">
          <div class="mkt-big" :style="{ color: data.latest.color }">
            {{ data.latest.ratio }}%
          </div>
          <div class="mkt-level" :style="{ color: data.latest.color }">
            {{ data.latest.label }}
          </div>
          <div class="mkt-detail">
            前5%个股 {{ data.latest.top5Pct }}亿 / 全市场 {{ data.latest.totalAmount }}亿
          </div>
          <div class="mkt-date">数据日期：{{ fmtDate(data.latest.trade_date) }}</div>
        </div>
      </div>

      <!-- 30日历史曲线 -->
      <div class="chart-header-mini">📈 30日趋势</div>
      <div ref="chartRef" class="chart-area"></div>

      <!-- 说明 -->
      <div class="mkt-note">
        <span :style="{color:'#C94B3D'}">≥50% 极度拥挤</span>
        <span :style="{color:'#F0A030'}">≥40% 拥挤</span>
        <span :style="{color:'#F5C842'}">≥30% 偏热</span>
        <span :style="{color:'#2D8B6F'}">20-30% 正常</span>
        <span :style="{color:'#456B8F'}">&lt;20% 冷清</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'

interface CrowdingPoint {
  trade_date: string; top5Pct: number; totalAmount: number; ratio: number
  level?: string; label?: string; color?: string
}
interface CrowdingResult {
  success: boolean; error?: string; updatedAt: string
  latest: CrowdingPoint
  series: CrowdingPoint[]
  periods: { days: number; topPct: number }
}

const loading = ref(false)
const error = ref('')
const data = ref<CrowdingResult | null>(null)

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const gaugeY = computed(() => {
  if (!data.value) return 180
  const r = data.value.latest.ratio
  // 映射 ratio(0~60) → y(180~24)
  const y = 180 - (Math.min(60, r) / 60) * 156
  return Math.max(24, Math.min(180, y))
})

function fmtDate(d: string): string {
  if (!d || d.length < 8) return d
  return `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`
}

function buildChart() {
  if (!chartRef.value || !data.value?.series.length) return
  if (chart) chart.dispose()

  chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
  const s = data.value.series

  const dates = s.map(p => fmtDate(p.trade_date))
  const ratios = s.map(p => p.ratio)

  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(26,29,39,0.95)',
      borderColor: '#D8CDBB',
      textStyle: { color: '#2B241C', fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0]
        const r = p.value as number
        let level = r >= 50 ? '🔴 极度拥挤' : r >= 40 ? '🟠 拥挤' : r >= 30 ? '🟡 偏热' : r < 20 ? '🔵 冷清' : '🟢 正常'
        return `<strong>${p.axisValue}</strong><br>集中度: ${r}% ${level}`
      },
    },
    grid: { left: 45, right: 20, top: 10, bottom: 25 },
    xAxis: {
      type: 'category', data: dates,
      axisLine: { lineStyle: { color: '#D8CDBB' } },
      axisLabel: { color: '#909399', fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: 'value', min: 0, max: 60,
      axisLine: { lineStyle: { color: '#D8CDBB' } },
      axisLabel: { color: '#909399', fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(42,46,57,0.3)', type: 'dashed' } },
    },
    series: [{
      type: 'line',
      data: ratios,
      smooth: true,
      lineStyle: { color: '#456B8F', width: 2 },
      itemStyle: {
        color: (params: any) => {
          const v = params.value as number
          if (v >= 50) return '#C94B3D'
          if (v >= 40) return '#F0A030'
          if (v >= 30) return '#F5C842'
          if (v < 20) return '#456B8F'
          return '#2D8B6F'
        },
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(51,112,255,0.15)' },
          { offset: 1, color: 'rgba(51,112,255,0.02)' },
        ]),
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed' },
        data: [
          { yAxis: 50, lineStyle: { color: 'rgba(225,82,65,0.4)' }, label: { formatter: '极度拥挤', color: '#C94B3D', fontSize: 10 } },
          { yAxis: 40, lineStyle: { color: 'rgba(240,160,48,0.4)' }, label: { formatter: '拥挤', color: '#F0A030', fontSize: 10 } },
          { yAxis: 30, lineStyle: { color: 'rgba(245,200,66,0.4)' }, label: { formatter: '偏热', color: '#F5C842', fontSize: 10 } },
        ],
      },
    }],
  }
  chart.setOption(option)
  window.addEventListener('resize', () => chart?.resize())
}

async function refresh() {
  loading.value = true; error.value = ''
  try {
    const res = await $fetch<CrowdingResult>('/api/market/crowding', { query: { force: 'true' } })
    if (!res.success) { error.value = res.error || '加载失败'; return }
    data.value = res
    nextTick(buildChart)
  } catch (e: any) {
    error.value = e?.message || '请求失败'
  } finally { loading.value = false }
}

watch(() => data.value?.series, () => nextTick(buildChart))
onMounted(async () => {
  try {
    loading.value = true
    const res = await $fetch<CrowdingResult>('/api/market/crowding')
    if (res.success) { data.value = res; nextTick(buildChart) }
  } catch { /* 静默 */ }
  loading.value = false
})
onBeforeUnmount(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.mkt-crowding {
  margin-bottom: 20px;
}
.mkt-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.mkt-header h3 { font-size: 16px; font-weight: 700; margin: 0; }
.mkt-sub { font-size: 12px; color: var(--text-secondary); }

.mkt-loading, .mkt-error {
  padding: 30px; text-align: center;
  color: var(--text-secondary);
}
.mkt-error { color: var(--color-down); }

.mkt-gauge-row {
  display: flex;
  gap: 24px;
  align-items: stretch;
  margin-bottom: 16px;
}
.mkt-gauge {
  width: 60px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.gauge-svg {
  width: 60px;
  height: 200px;
}
.gauge-labels {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 160px;
  font-size: 10px;
  margin-top: -180px;
  margin-left: 2px;
  pointer-events: none;
}

.mkt-value {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}
.mkt-big { font-size: 42px; font-weight: 800; letter-spacing: -1px; line-height: 1; }
.mkt-level { font-size: 18px; font-weight: 700; }
.mkt-detail { font-size: 12px; color: var(--text-secondary); }
.mkt-date { font-size: 11px; color: var(--text-muted); }

.chart-header-mini {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.chart-area {
  width: 100%;
  height: 200px;
}

.mkt-note {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .mkt-big { font-size: 32px; }
  .mkt-level { font-size: 15px; }
  .mkt-gauge { width: 48px; }
  .gauge-svg { width: 48px; height: 160px; }
  .chart-area { height: 160px; }
}
</style>
