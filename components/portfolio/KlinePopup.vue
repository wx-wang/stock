<template>
  <Teleport to="body">
    <div class="kline-overlay" @click.self="$emit('close')">
      <div class="kline-container">
        <div class="kline-header">
          <h3 class="kline-title">{{ stockName }} <span class="kline-code">{{ tsCode }}</span></h3>
          <button class="kline-close" @click="$emit('close')">✕</button>
        </div>

        <div v-if="loading" class="kline-status">⏳ 加载K线数据...</div>
        <div v-if="error" class="kline-status kline-error">⚠️ {{ error }}</div>

        <div class="kline-legend" v-if="!loading && !error">
          <span v-if="markDate" class="legend-item mark-date">⭐ {{ markDate }}</span>
          <span v-if="markDate" class="legend-sep">|</span>
          <span class="legend-item ma5">MA5</span>
          <span class="legend-item ma10">MA10</span>
          <span class="legend-item ma20">MA20</span>
          <span class="legend-item ma60">MA60</span>
          <span class="legend-item ma120">MA120</span>
          <span class="legend-sep">|</span>
          <span class="legend-item macd-dif">DIF</span>
          <span class="legend-item macd-dea">DEA</span>
          <span class="legend-item macd-bar">MACD</span>
          <span class="legend-sep">|</span>
          <span class="legend-item kdj-k">K</span>
          <span class="legend-item kdj-d">D</span>
          <span class="legend-item kdj-j">J</span>
          <span class="legend-info">KDJ(25,3,3)</span>
        </div>

        <div ref="chartRef" class="kline-chart" v-show="!loading && !error"></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'

const props = defineProps<{ tsCode: string; stockName: string; shares?: number; cost?: number; markDate?: string }>()
defineEmits<{ close: [] }>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const loading = ref(false)
const error = ref<string | null>(null)

interface KlineData {
  dates: string[]
  kdata: number[][]  // [open, close, low, high]
  volumes: number[]
  ma5: (number | null)[]; ma10: (number | null)[]; ma20: (number | null)[]; ma60: (number | null)[]; ma120: (number | null)[]
  macd_dif: (number | null)[]; macd_dea: (number | null)[]; macd_bar: (number | null)[]
  kdj_k: (number | null)[]; kdj_d: (number | null)[]; kdj_j: (number | null)[]
}

async function fetchKline() {
  loading.value = true; error.value = null
  try {
    const resp = await fetch(`/api/stocks/kline?ts_code=${props.tsCode}&days=250`)
    const json = await resp.json()
    if (!json.success) { error.value = json.error; return }
    nextTick(() => renderChart(json.data))
  } catch (e: any) { error.value = e.message } finally { loading.value = false }
}

function renderChart(data: KlineData) {
  if (!chartRef.value) return
  if (chart) { chart.dispose(); chart = null }
  chart = echarts.init(chartRef.value)

  const dates = data.dates.map(d => d.slice(4, 6) + '/' + d.slice(6))
  const defaultStart = Math.max(0, 100 - 120 * 100 / data.dates.length)

  // 自选日标记：找到 markDate 在 dates 中的索引
  let markIdx = -1
  if (props.markDate) {
    const md = props.markDate.replace(/-/g, '')  // "2026-05-20" → "20260520"
    markIdx = data.dates.findIndex((d: string) => d === md)
  }

  const series: any[] = [
    // —— 成交量 ——————————————————————
    {
      name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
      data: data.kdata.map((k, i) => ({
        value: data.volumes[i] / 10000,
        itemStyle: { color: k[1] >= k[0] ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)' },
      })),
    },
    // —— K线 ——————————————————————
    {
      name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0,
      data: data.kdata,
      itemStyle: { color: '#ef4444', color0: '#22c55e', borderColor: '#ef4444', borderColor0: '#22c55e' },
      markLine: markIdx >= 0 ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.5 },
        label: { formatter: `⭐ 自选日\n${props.markDate}`, position: 'start', color: '#f59e0b', fontSize: 11, fontWeight: 700 },
        data: [{ xAxis: markIdx }],
      } : undefined,
    },
    // —— 均线 ——————————————————————
    { name: 'MA5',  type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.ma5,  symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 } },
    { name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.ma10, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1 } },
    { name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.ma20, symbol: 'none', lineStyle: { color: '#a855f7', width: 1 } },
    { name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.ma60, symbol: 'none', lineStyle: { color: '#ec4899', width: 1 } },
    { name: 'MA120', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.ma120, symbol: 'none', lineStyle: { color: '#14b8a6', width: 1 } },
    // —— MACD ——————————————————————
    {
      name: 'MACD', type: 'bar', xAxisIndex: 2, yAxisIndex: 2,
      data: data.macd_bar.map(v => v == null ? null : {
        value: v,
        itemStyle: { color: v >= 0 ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)' },
      }),
    },
    { name: 'DIF', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: data.macd_dif, symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 } },
    { name: 'DEA', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: data.macd_dea, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1 } },
    // —— KDJ ——————————————————————
    { name: 'K', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: data.kdj_k, symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 } },
    { name: 'D', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: data.kdj_d, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1 } },
    { name: 'J', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: data.kdj_j, symbol: 'none', lineStyle: { color: '#a855f7', width: 1 } },
  ]

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: any[]) => {
        const k = params.find((p: any) => p.seriesName === 'K线')
        if (!k) return ''
        const d = k.data
        const dif = params.find((p: any) => p.seriesName === 'DIF')
        const kdj = params.find((p: any) => p.seriesName === 'K')
        const label = markIdx >= 0 && k.dataIndex === markIdx ? ' ⭐ 自选日' : ''
        return [
          `<strong>${k.axisValueLabel}${label}</strong>`,
          `开:${d[0]?.toFixed(2)} 收:${d[1]?.toFixed(2)}`,
          `低:${d[2]?.toFixed(2)} 高:${d[3]?.toFixed(2)}`,
          dif?.data != null ? `DIF:${dif.data.toFixed(3)} DEA:${params.find((p:any)=>p.seriesName==='DEA')?.data?.toFixed(3)||'-'}` : '',
          kdj?.data != null ? `K:${kdj.data.toFixed(2)} D:${params.find((p:any)=>p.seriesName==='D')?.data?.toFixed(2)||'-'} J:${params.find((p:any)=>p.seriesName==='J')?.data?.toFixed(2)||'-'}` : '',
        ].filter(Boolean).join('<br/>')
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 70, right: 30, top: 10, height: '42%' },
      { left: 70, right: 30, top: '55%', height: '12%' },
      { left: 70, right: 30, top: '70%', height: '13%' },
      { left: 70, right: 30, top: '86%', height: '10%' },
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#555' } } },
      { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#555' } } },
      { type: 'category', data: dates, gridIndex: 2, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#555' } } },
      { type: 'category', data: dates, gridIndex: 3, axisLabel: { color: '#999', fontSize: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#555' } } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, splitNumber: 4, axisLabel: { color: '#999', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }, axisLine: { lineStyle: { color: '#555' } } },
      { type: 'value', gridIndex: 1, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { show: false }, axisLine: { lineStyle: { color: '#555' } } },
      { type: 'value', gridIndex: 2, scale: true, splitNumber: 3, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }, axisLine: { lineStyle: { color: '#555' } } },
      { type: 'value', gridIndex: 3, min: 0, max: 100, splitNumber: 2, axisLabel: { color: '#999', fontSize: 10, formatter: '{value}' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }, axisLine: { lineStyle: { color: '#555' } } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: defaultStart, end: 100 },
    ],
    series,
  })

  const observer = new ResizeObserver(() => chart?.resize())
  observer.observe(chartRef.value)
}

watch(() => props.tsCode, () => { if (props.tsCode) fetchKline() }, { immediate: true })
onUnmounted(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.kline-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
  z-index: 9999; backdrop-filter: blur(2px);
}
.kline-container {
  background: var(--bg-card, #1a1a2e); border: 1px solid var(--border-color, #2a2a4a);
  border-radius: 12px; width: 960px; max-width: 95vw; max-height: 95vh;
  overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.kline-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; border-bottom: 1px solid var(--border-color, #2a2a4a);
}
.kline-title { font-size: 16px; font-weight: 700; margin: 0; }
.kline-code { font-size: 12px; color: var(--text-secondary, #888); font-family: monospace; margin-left: 8px; font-weight: 400; }
.kline-close { background: none; border: none; color: var(--text-secondary, #888); font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; line-height: 1; }
.kline-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

.kline-legend { display: flex; gap: 10px; align-items: center; padding: 8px 20px 0; font-size: 11px; font-weight: 600; flex-wrap: wrap; }
.legend-item { padding: 1px 4px; border-radius: 3px; }
.legend-item.ma5 { color: #f59e0b; } .legend-item.ma10 { color: #3b82f6; } .legend-item.ma20 { color: #a855f7; }
.legend-item.ma60 { color: #ec4899; } .legend-item.ma120 { color: #14b8a6; }
.legend-item.macd-dif { color: #f59e0b; } .legend-item.macd-dea { color: #3b82f6; } .legend-item.macd-bar { color: #ef4444; }
.legend-item.kdj-k { color: #f59e0b; } .legend-item.kdj-d { color: #3b82f6; } .legend-item.kdj-j { color: #a855f7; }
.legend-item.mark-date { color: #f59e0b; font-size: 12px; }
.legend-sep { color: #444; }
.legend-info { color: var(--text-secondary, #888); font-weight: 400; margin-left: auto; }

.kline-chart { width: 100%; height: 680px; flex-shrink: 0; }

.kline-status { padding: 100px 20px; text-align: center; color: var(--text-secondary, #888); }
.kline-error { color: var(--color-down, #ef4444); }
</style>
