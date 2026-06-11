<template>
  <div class="ef-container">
    <div class="ef-header">
      <h3 class="ef-title">有效前沿 (Efficient Frontier)</h3>
      <div class="ef-meta">
        <span>{{ data?.tradingDays || '--' }} 个交易日</span>
        <span>无风险利率 {{ ((data?.riskFree || 0) * 100).toFixed(1) }}%</span>
        <button class="btn btn-outline btn-sm" @click="$emit('refresh')" :disabled="loading">
          {{ loading ? '⏳ 计算中...' : '🔄 重新计算' }}
        </button>
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="ef-cards" v-if="data">
      <div class="ef-card">
        <div class="ef-card-label">最小方差组合 (MVP)</div>
        <div class="ef-card-row"><span>年化收益</span><span class="val">{{ (mvp.ret * 100).toFixed(2) }}%</span></div>
        <div class="ef-card-row"><span>年化波动</span><span class="val">{{ (mvp.vol * 100).toFixed(2) }}%</span></div>
      </div>
      <div class="ef-card ef-card-accent">
        <div class="ef-card-label">⭐ 最大 Sharpe (切点)</div>
        <div class="ef-card-row"><span>年化收益</span><span class="val">{{ (tangency.ret * 100).toFixed(2) }}%</span></div>
        <div class="ef-card-row"><span>年化波动</span><span class="val">{{ (tangency.vol * 100).toFixed(2) }}%</span></div>
        <div class="ef-card-row"><span>Sharpe</span><span class="val">{{ tangency.sharpe.toFixed(3) }}</span></div>
      </div>
      <div class="ef-card" v-if="currentPos">
        <div class="ef-card-label">当前持仓</div>
        <div class="ef-card-row"><span>年化收益</span><span class="val">{{ (currentPos.ret * 100).toFixed(2) }}%</span></div>
        <div class="ef-card-row"><span>年化波动</span><span class="val">{{ (currentPos.vol * 100).toFixed(2) }}%</span></div>
        <div class="ef-card-row"><span>Sharpe</span><span class="val">{{ currentPos.sharpe.toFixed(3) }}</span></div>
      </div>
    </div>

    <!-- 图表 -->
    <div ref="chartRef" class="ef-chart" v-show="data"></div>
    <div v-if="loading" class="ef-loading">⏳ 正在计算有效前沿...</div>
    <div v-if="error" class="ef-error">{{ error }}</div>

    <!-- 再平衡建议 -->
    <div class="ef-rebalance" v-if="data && currentPos">
      <h4>📋 再平衡建议（当前 → 最大 Sharpe）</h4>
      <table class="rebalance-table">
        <thead>
          <tr>
            <th>股票</th>
            <th class="num">当前权重</th>
            <th class="num">最优权重</th>
            <th class="num">差异</th>
            <th class="num">当前市值</th>
            <th>操作建议</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rebalanceRows" :key="r.code"
            :class="{ 'row-up': r.diff > 0.01, 'row-down': r.diff < -0.01 }">
            <td>{{ r.name }}</td>
            <td class="num">{{ (r.currentW * 100).toFixed(1) }}%</td>
            <td class="num">{{ (r.targetW * 100).toFixed(1) }}%</td>
            <td class="num" :style="{ color: r.diff > 0.01 ? 'var(--color-up)' : r.diff < -0.01 ? 'var(--color-down)' : 'var(--text-secondary)' }">
              {{ r.diff > 0 ? '+' : '' }}{{ (r.diff * 100).toFixed(1) }}%
            </td>
            <td class="num">{{ formatMoney(r.mv) }}</td>
            <td>{{ r.action }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { formatMoney } from '~/utils/formatters'

const props = defineProps<{
  holdings: Array<{ ts_code: string; name: string; shares: number; cost: number; close?: number; marketValue?: number }>
}>()
const emit = defineEmits<{ refresh: [] }>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<any>(null)

// 缓存：holdings 的 ts_codes 列表
const codesKey = computed(() => props.holdings.map(h => h.ts_code).sort().join(','))

// ===== 拉取数据 =====
async function fetchData() {
  if (props.holdings.length < 2) { error.value = '至少需要 2 只持仓'; return }
  loading.value = true; error.value = null
  try {
    const codes = props.holdings.map(h => h.ts_code).join(',')
    const resp = await fetch(`/api/portfolio/efficient-frontier?ts_codes=${codes}&days=250&risk_free=2.5`)
    const json = await resp.json()
    if (!json.success) { error.value = json.error; return }
    data.value = json.data
    nextTick(() => renderChart())
  } catch (e: any) { error.value = e.message } finally { loading.value = false }
}

// ===== 当前持仓位置 =====
const currentPos = computed(() => {
  if (!data.value) return null
  const d = data.value
  const n = d.codes.length
  const totalMV = props.holdings.reduce((s, h) => s + (h.close || 0) * h.shares, 0)
  if (totalMV <= 0) return null
  const w = d.codes.map((c: string) => {
    const h = props.holdings.find((x: any) => x.ts_code === c)
    return h ? (h.close || 0) * h.shares / totalMV : 0
  })
  const ret = dotProd(w, d.meanReturns)
  const vol = Math.sqrt(portfolioVar(w, d.covMatrix))
  const sharpe = (ret - d.riskFree) / vol
  return { ret, vol, sharpe, weights: w }
})

// ===== 派生数据 =====
const mvp = computed(() => {
  if (!data.value) return { ret: 0, vol: 0 }
  const ef = data.value.frontier
  return { ret: ef.returns[0], vol: ef.vols[0] }
})
const tangency = computed(() => {
  if (!data.value) return { ret: 0, vol: 0, sharpe: 0 }
  return data.value.tangency
})

// ===== 再平衡表 =====
const rebalanceRows = computed(() => {
  if (!data.value || !currentPos.value) return []
  const d = data.value
  const n = d.codes.length
  const tw = d.tangency.weights
  const cw = currentPos.value.weights
  const totalMV = props.holdings.reduce((s, h) => s + (h.close || 0) * h.shares, 0)

  const rows: any[] = []
  for (let i = 0; i < n; i++) {
    const h = props.holdings.find((x: any) => x.ts_code === d.codes[i])
    const mv = (h?.close || 0) * (h?.shares || 0)
    const diff = tw[i] - cw[i]
    let action = '--'
    const diffAmount = diff * totalMV
    if (Math.abs(diff) > 0.01) {
      const price = h?.close || 1
      const shares = Math.abs(Math.round(diffAmount / price / 100) * 100)
      if (diff > 0) action = `加仓 ${shares} 股`
      else action = `减仓 ${shares} 股`
    }
    rows.push({
      code: d.codes[i], name: d.names[i],
      currentW: cw[i], targetW: tw[i], diff,
      mv, action,
    })
  }
  return rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
})

// ===== ECharts 渲染 =====
function renderChart() {
  if (!chartRef.value || !data.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  else chart.resize()

  const d = data.value
  const ef = d.frontier
  const singleS = d.singleStocks

  // 只显示名字（截断）
  const shortNames = d.names.map((n: string) => n.length > 4 ? n.slice(0, 4) : n)

  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        if (p.seriesName === '有效前沿') return `有效前沿<br/>波动: ${(p.data[0]*100).toFixed(2)}%<br/>收益: ${(p.data[1]*100).toFixed(2)}%`
        if (p.seriesName === '单只股票') return `${p.name}<br/>波动: ${(p.data[0]*100).toFixed(2)}%<br/>收益: ${(p.data[1]*100).toFixed(2)}%`
        if (p.seriesName === '当前持仓') return `当前持仓<br/>波动: ${(p.data[0]*100).toFixed(2)}%<br/>收益: ${(p.data[1]*100).toFixed(2)}%`
        if (p.seriesName === 'CML') return `资本市场线<br/>Sharpe: ${d.tangency.sharpe.toFixed(3)}`
        return `${p.name}<br/>收益: ${(p.data[1]*100).toFixed(2)}%<br/>波动: ${(p.data[0]*100).toFixed(2)}%`
      },
    },
    legend: { bottom: 0, textStyle: { color: '#888', fontSize: 11 } },
    grid: { left: 55, right: 20, top: 15, bottom: 35 },
    xAxis: {
      type: 'value', name: '年化波动率 (%)',
      axisLabel: { formatter: (v: number) => (v * 100).toFixed(0) + '%', color: '#888' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    yAxis: {
      type: 'value', name: '年化收益率 (%)',
      axisLabel: { formatter: (v: number) => (v * 100).toFixed(0) + '%', color: '#888' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      // Effective Frontier
      {
        name: '有效前沿', type: 'line',
        data: ef.vols.map((v: number, i: number) => [v, ef.returns[i]]),
        smooth: true, symbol: 'none',
        lineStyle: { color: '#3370ff', width: 2.5 },
        z: 1,
      },
      // CML
      {
        name: 'CML', type: 'line',
        data: [
          [d.cml[0].vol, d.cml[0].ret],
          [d.cml[1].vol, d.cml[1].ret],
        ],
        lineStyle: { color: '#22c55e', type: 'dashed', width: 1.5 },
        symbol: 'none', z: 0,
      },
      // Tangency
      {
        name: '切点组合', type: 'scatter',
        data: [[d.tangency.vol, d.tangency.ret]],
        symbol: 'diamond', symbolSize: 14,
        itemStyle: { color: '#22c55e', borderColor: '#fff', borderWidth: 2 },
        z: 3,
        label: { show: true, position: 'top', formatter: '切点', color: '#22c55e', fontSize: 11 },
      },
      // Individual stocks
      {
        name: '单只股票', type: 'scatter',
        data: singleS.map((s: any, i: number) => ({
          value: [s.vol, s.ret],
          name: shortNames[i] + ' (' + s.code + ')',
        })),
        symbolSize: 10,
        itemStyle: { color: '#ef4444', opacity: 0.7 },
        z: 2,
        label: { show: false },
      },
      // Current portfolio
      ...(currentPos.value ? [{
        name: '当前持仓', type: 'scatter' as const,
        data: [[currentPos.value.vol, currentPos.value.ret]],
        symbol: 'star', symbolSize: 18,
        itemStyle: { color: '#f59e0b', borderColor: '#fff', borderWidth: 2 },
        z: 4,
        label: { show: true, position: 'right', formatter: '当前', color: '#f59e0b', fontSize: 12, fontWeight: 'bold' },
      }] : []),
    ],
  }, true)
}

function dotProd(a: number[], b: number[]) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
function portfolioVar(w: number[], cov: number[][]) { let v = 0; for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) v += w[i] * cov[i][j] * w[j]; return v }

// ===== 生命周期 =====
watch(codesKey, () => { fetchData() }, { immediate: true })

onUnmounted(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.ef-container {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 20px;
}

.ef-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; flex-wrap: wrap; gap: 8px;
}

.ef-title { font-size: 16px; font-weight: 700; margin: 0; }

.ef-meta {
  display: flex; align-items: center; gap: 12px;
  font-size: 12px; color: var(--text-secondary);
}

.ef-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.ef-card {
  background: var(--bg-input);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
}

.ef-card-accent {
  border: 1px solid rgba(51,112,255,0.2);
  background: rgba(51,112,255,0.05);
}

.ef-card-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.ef-card-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
.ef-card-row .val { font-weight: 600; font-variant-numeric: tabular-nums; }

.ef-chart { width: 100%; height: 420px; }

.ef-loading, .ef-error {
  text-align: center; padding: 40px; color: var(--text-secondary); font-size: 14px;
}
.ef-error { color: var(--color-down); }

.ef-rebalance { margin-top: 20px; }
.ef-rebalance h4 { font-size: 14px; font-weight: 700; margin-bottom: 10px; }

.rebalance-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
.rebalance-table th {
  text-align: left; padding: 8px 10px;
  border-bottom: 2px solid var(--border-color);
  color: var(--text-secondary); font-weight: 600; font-size: 12px;
}
.rebalance-table td {
  padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.03);
}
.rebalance-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.row-up { background: rgba(34,197,94,0.05); }
.row-down { background: rgba(239,68,68,0.05); }
</style>
