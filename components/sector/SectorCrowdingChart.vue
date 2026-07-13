<!-- SectorCrowdingChart.vue — 拥挤度 × 拥挤度变化 散点图 -->
<template>
  <div class="crowding-chart-card card">
    <div class="chart-header">
      <h3>🔥 行业拥挤度</h3>
      <span class="chart-sub">成交额占比分位数 × 5日变化</span>
    </div>

    <div v-if="loading" class="chart-loading">加载中...</div>
    <div v-else-if="error" class="chart-error">{{ error }}</div>
    <div v-else-if="!validSectors.length" class="chart-empty">暂无拥挤度数据</div>

    <div ref="chartRef" class="chart-container" v-show="validSectors.length"></div>

    <!-- 图例 -->
    <div class="crowding-legend">
      <div class="legend-item"><span class="legend-dot dot-red"></span>拥挤加剧</div>
      <div class="legend-item"><span class="legend-dot dot-orange"></span>拥挤消退</div>
      <div class="legend-item"><span class="legend-dot dot-blue"></span>资金涌入</div>
      <div class="legend-item"><span class="legend-dot dot-green"></span>冷清低位</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'

interface SectorData {
  ts_code: string; name: string
  beta: number; alphaAnnual: number
  cumulativeReturn?: number; rps?: number
  sharpe?: number; conclusion?: string
  crowdingPct?: number; crowdingChange?: number
  error?: string
}

const props = defineProps<{
  sectors: SectorData[]
  loading?: boolean
  error?: string | null
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const validSectors = computed(() =>
  props.sectors.filter(s => !s.error && (s.crowdingPct ?? 0) > 0)
)

function quadrantColor(pct: number, chg: number): string {
  if (pct >= 50 && chg >= 0) return '#C94B3D'     // 拥挤+加剧 → 红
  if (pct >= 50 && chg < 0) return '#F0A030'       // 拥挤+消退 → 橙
  if (pct < 50 && chg >= 0) return '#456B8F'        // 冷清+涌入 → 蓝
  return '#2D8B6F'                                  // 冷清+低位 → 绿
}

function quadrantLabel(pct: number, chg: number): string {
  if (pct >= 50 && chg >= 0) return '拥挤加剧 ⚠️'
  if (pct >= 50 && chg < 0) return '拥挤消退 👀'
  if (pct < 50 && chg >= 0) return '资金涌入 🔥'
  return '冷清低位 💤'
}

function sectorTooltip(s: SectorData): string {
  const pct = s.crowdingPct ?? 0
  const chg = s.crowdingChange ?? 0
  return [
    `<strong>${s.name}</strong>`,
    `拥挤度: ${pct}分位`,
    `5日变化: ${chg > 0 ? '+' : ''}${chg}%`,
    `α年化: ${(s.alphaAnnual * 100).toFixed(1)}%`,
    `β: ${s.beta.toFixed(2)}`,
    `象限: ${quadrantLabel(pct, chg)}`,
    s.conclusion ? `<br><span style="font-size:11px;color:#909399">${s.conclusion}</span>` : '',
  ].join('<br>')
}

function buildChart() {
  if (!chartRef.value || !validSectors.value.length) return
  if (chart) chart.dispose()

  chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })

  const data = validSectors.value.map(s => ({
    name: s.name,
    value: [s.crowdingPct ?? 50, s.crowdingChange ?? 0],
    size: Math.max(8, Math.min(30, Math.abs(s.alphaAnnual) * 60 + 8)),
    itemStyle: { color: quadrantColor(s.crowdingPct ?? 50, s.crowdingChange ?? 0) },
    tooltipData: s,
  }))

  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(26,29,39,0.95)',
      borderColor: '#D8CDBB',
      textStyle: { color: '#2B241C', fontSize: 12 },
      formatter: (params: any) => sectorTooltip(params.data.tooltipData),
    },
    grid: { left: 50, right: 30, top: 20, bottom: 40 },
    xAxis: {
      name: '拥挤度（成交额占比分位数）',
      nameLocation: 'center',
      nameGap: 28,
      nameTextStyle: { color: '#909399', fontSize: 11 },
      type: 'value', min: 0, max: 100,
      axisLine: { lineStyle: { color: '#D8CDBB' } },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(42,46,57,0.4)', type: 'dashed' } },
      axisLabel: { color: '#909399', fontSize: 10, formatter: '{value}' },
    },
    yAxis: {
      name: '5日拥挤度变化 (%)',
      nameLocation: 'center',
      nameGap: 35,
      nameTextStyle: { color: '#909399', fontSize: 11 },
      type: 'value',
      axisLine: { lineStyle: { color: '#D8CDBB' } },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(42,46,57,0.4)', type: 'dashed' } },
      axisLabel: { color: '#909399', fontSize: 10, formatter: '{value}%' },
    },
    series: [{
      type: 'scatter',
      symbolSize: (val: any) => val[2] || 10,
      data: data,
      emphasis: {
        focus: 'series',
        scale: 1.3,
        label: { show: true, formatter: '{b}', position: 'top', color: '#2B241C', fontSize: 12 },
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: 'rgba(144,147,153,0.3)', type: 'dashed' },
        data: [
          { xAxis: 50, label: { formatter: '拥挤线', color: '#909399', fontSize: 10 } },
          { yAxis: 0, label: { formatter: '零变化', color: '#909399', fontSize: 10 } },
        ],
      },
    }],
  }

  chart.setOption(option)
  window.addEventListener('resize', () => chart?.resize())
}

watch(validSectors, () => nextTick(buildChart), { deep: true })
onMounted(() => nextTick(buildChart))
onBeforeUnmount(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.crowding-chart-card {
  margin-top: 24px;
}
.chart-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
.chart-header h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.chart-sub {
  font-size: 12px;
  color: var(--text-secondary);
}
.chart-container {
  width: 100%;
  height: 420px;
}
.chart-loading, .chart-error, .chart-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}
.chart-error { color: var(--color-down); }
.crowding-legend {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot-red { background: #C94B3D; }
.dot-orange { background: #F0A030; }
.dot-blue { background: #456B8F; }
.dot-green { background: #2D8B6F; }

@media (max-width: 768px) {
  .chart-container { height: 320px; }
  .crowding-legend { gap: 10px; }
}
</style>
