<template>
  <div class="capm-container">
    <div class="capm-header">
      <h3 class="capm-title">CAPM 分析（vs {{ data?.indexName || '沪深300' }}，{{ data?.days || '--' }}日）</h3>
      <button class="btn btn-outline btn-sm" @click="$emit('refresh')" :disabled="loading">
        {{ loading ? '⏳ 计算中...' : '🔄 重新计算' }}
      </button>
    </div>

    <!-- 组合汇总卡片 -->
    <div class="capm-cards" v-if="data && portfolioSummary">
      <div class="capm-card">
        <div class="capm-card-label">组合 β (加权)</div>
        <div class="capm-card-value" :class="portfolioSummary.beta > 1 ? 'val-up' : 'val-down'">
          {{ portfolioSummary.beta.toFixed(3) }}
        </div>
        <div class="capm-card-sub">{{ portfolioSummary.beta > 1 ? '偏进攻' : '防御型' }}</div>
      </div>
      <div class="capm-card">
        <div class="capm-card-label">组合 α (年化)</div>
        <div class="capm-card-value" :class="portfolioSummary.alphaAnnual > 0 ? 'val-up' : 'val-down'">
          {{ (portfolioSummary.alphaAnnual * 100).toFixed(2) }}%
        </div>
        <div class="capm-card-sub">{{ portfolioSummary.alphaAnnual > 0.03 ? '显著超额收益' : portfolioSummary.alphaAnnual < -0.03 ? '跑输市场' : '≈0' }}</div>
      </div>
      <div class="capm-card">
        <div class="capm-card-label">系统性风险</div>
        <div class="capm-card-value neutral">{{ (portfolioSummary.systematicRisk * 100).toFixed(2) }}%</div>
      </div>
      <div class="capm-card">
        <div class="capm-card-label">非系统性风险</div>
        <div class="capm-card-value neutral">{{ (portfolioSummary.nonsystematicRisk * 100).toFixed(2) }}%</div>
      </div>
      <div class="capm-card">
        <div class="capm-card-label">总风险</div>
        <div class="capm-card-value neutral">{{ (portfolioSummary.totalRisk * 100).toFixed(2) }}%</div>
        <div class="capm-card-sub">
          方差占比 系统 {{ (portfolioSummary.sysPct * 100).toFixed(0) }}% / 非系统 {{ (portfolioSummary.nonsysPct * 100).toFixed(0) }}%
        </div>
      </div>
    </div>

    <!-- 风险收益效率卡片 -->
    <div class="capm-cards capm-cards-ratio" v-if="data && portfolioSummary">
      <div class="capm-card capm-card-sharpe">
        <div class="capm-card-label">夏普比率 (Sharpe)</div>
        <div class="capm-card-value" :class="portfolioSummary.sharpe > 1 ? 'val-up' : portfolioSummary.sharpe > 0 ? 'neutral' : 'val-down'">
          {{ portfolioSummary.sharpe.toFixed(2) }}
        </div>
        <div class="capm-card-sub">{{ portfolioSummary.sharpe > 2 ? '⭐ 卓越' : portfolioSummary.sharpe > 1 ? '良好' : portfolioSummary.sharpe > 0 ? '一般' : '负收益' }}</div>
      </div>
      <div class="capm-card capm-card-treynor">
        <div class="capm-card-label">特雷诺比率 (Treynor)</div>
        <div class="capm-card-value" :class="portfolioSummary.treynor > 0.2 ? 'val-up' : portfolioSummary.treynor > 0 ? 'neutral' : 'val-down'">
          {{ portfolioSummary.treynor.toFixed(4) }}
        </div>
        <div class="capm-card-sub">{{ portfolioSummary.treynor > 0.5 ? '⭐ 高β效率' : portfolioSummary.treynor > 0.1 ? '可接受' : portfolioSummary.treynor > 0 ? '偏低' : '负值' }}</div>
      </div>
      <div class="capm-card capm-card-ir">
        <div class="capm-card-label">信息比率 (IR)</div>
        <div class="capm-card-value" :class="portfolioSummary.ir > 0.5 ? 'val-up' : portfolioSummary.ir > 0 ? 'neutral' : 'val-down'">
          {{ portfolioSummary.ir.toFixed(2) }}
        </div>
        <div class="capm-card-sub">{{ portfolioSummary.ir > 1 ? '⭐ α质量极高' : portfolioSummary.ir > 0.5 ? 'α有统计意义' : portfolioSummary.ir > 0 ? 'α勉强' : '负α' }}</div>
      </div>
    </div>

    <!-- 图表 -->
    <div ref="chartRef" class="capm-chart" v-show="data"></div>

    <!-- 加载/错误 -->
    <div v-if="loading" class="capm-loading">⏳ 正在计算 CAPM 回归...</div>
    <div v-if="error" class="capm-error">{{ error }}</div>

    <!-- 个股表格 -->
    <div class="capm-table-wrap" v-if="data && data.stocks">
      <h4>📊 个股 CAPM 分析</h4>
      <table class="capm-table">
        <thead>
          <tr>
            <th>股票</th>
            <th class="num">β</th>
            <th class="num">α (年化)</th>
            <th class="num">非系统风险(年化)</th>
            <th class="num">系统风险(年化)</th>
            <th class="num">总风险(年化)</th>
            <th class="num">R²</th>
            <th class="num">t值</th>
            <th class="num">夏普</th>
            <th class="num">特雷诺</th>
            <th class="num">IR</th>
            <th>结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sortedStocks" :key="s.code" :class="rowClass(s)">
            <td class="name-cell">
              <span class="stock-name">{{ s.name }}</span>
              <span class="stock-code">{{ s.code }}</span>
            </td>
            <td class="num" :style="{ color: s.beta > 1.2 ? 'var(--color-up)' : s.beta < 0.8 ? 'var(--color-down)' : 'var(--text-primary)' }">
              {{ s.beta.toFixed(3) }}
            </td>
            <td class="num" :class="s.alphaAnnual > 0.03 ? 'positive' : s.alphaAnnual < -0.03 ? 'negative' : ''">
              {{ (s.alphaAnnual * 100).toFixed(2) }}%
            </td>
            <td class="num">{{ (s.sigmaEpsilonAnnual * 100).toFixed(2) }}%</td>
            <td class="num">{{ (s.systematicRiskAnnual * 100).toFixed(2) }}%</td>
            <td class="num">{{ (s.totalRiskAnnual * 100).toFixed(2) }}%</td>
            <td class="num">{{ (s.rSquared * 100).toFixed(1) }}%</td>
            <td class="num" :class="s.significant ? 'bold' : ''">{{ s.tValue.toFixed(2) }}</td>
            <td class="num" :class="s.sharpe > 1 ? 'positive' : s.sharpe > 0 ? '' : 'negative'">{{ s.sharpe.toFixed(2) }}</td>
            <td class="num" :class="s.treynor > 0.2 ? 'positive' : s.treynor > 0 ? '' : 'negative'">{{ s.treynor.toFixed(4) }}</td>
            <td class="num" :class="s.ir > 0.5 ? 'positive' : s.ir > 0 ? '' : 'negative'">{{ s.ir.toFixed(2) }}</td>
            <td class="conclusion-cell">{{ s.conclusion }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'

const props = defineProps<{
  holdings: Array<{ ts_code: string; name: string; shares: number; cost: number; close?: number; marketValue?: number }>
}>()
const emit = defineEmits<{ refresh: [] }>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<any>(null)

const codesKey = computed(() => props.holdings.map(h => h.ts_code).sort().join(','))

// ===== 拉数据 =====
async function fetchData() {
  if (props.holdings.length < 1) return
  loading.value = true; error.value = null
  try {
    const codes = props.holdings.map(h => h.ts_code).join(',')
    const resp = await fetch(`/api/portfolio/capm?ts_codes=${codes}&days=500&threshold=2.0`)
    const json = await resp.json()
    if (!json.success) { error.value = json.error; return }
    data.value = json.data
    nextTick(() => renderChart())
  } catch (e: any) { error.value = e.message } finally { loading.value = false }
}

// ===== 组合汇总 =====
const RF = 0.015  // 无风险利率（1年期国债≈1.5%）

const portfolioSummary = computed(() => {
  if (!data.value) return null
  const d = data.value
  const n = d.codes.length
  const totalMV = props.holdings.reduce((s, h) => s + (h.close || 0) * h.shares, 0)
  if (totalMV <= 0) return null

  const w = d.codes.map((c: string) => {
    const h = props.holdings.find((x: any) => x.ts_code === c)
    return h ? (h.close || 0) * h.shares / totalMV : 0
  })

  let betaP = 0, alphaP = 0, nonsysVar = 0, expRetP = 0
  for (let i = 0; i < n; i++) {
    const s = d.stocks[i]
    betaP += w[i] * s.beta
    alphaP += w[i] * s.alphaAnnual
    expRetP += w[i] * (s.expectedReturn || 0)
    nonsysVar += w[i] * w[i] * (s.sigmaEpsilonAnnual ** 2)
  }

  const systematicRisk = Math.abs(betaP) * d.marketAnnualVol
  const nonsystematicRisk = Math.sqrt(nonsysVar)
  const totalVariance = systematicRisk ** 2 + nonsysVar
  const totalRisk = Math.sqrt(totalVariance)
  const sysPct = totalVariance > 0 ? (systematicRisk ** 2) / totalVariance : 0
  const nonsysPct = totalVariance > 0 ? nonsysVar / totalVariance : 0

  // ★ 风险调整收益比率
  const excessReturn = expRetP - RF
  const sharpe = totalRisk > 0 ? excessReturn / totalRisk : 0
  const treynor = Math.abs(betaP) > 0.01 ? excessReturn / betaP : 0
  const ir = nonsystematicRisk > 0 ? alphaP / nonsystematicRisk : 0

  return { beta: betaP, alphaAnnual: alphaP, systematicRisk, nonsystematicRisk, totalRisk, sysPct, nonsysPct,
    sharpe, treynor, ir }
})

// ===== 排序 =====
const sortedStocks = computed(() => {
  if (!data.value?.stocks) return []
  return [...data.value.stocks].map((s: any) => {
    const excess = (s.expectedReturn || 0) - RF
    return {
      ...s,
      sharpe: s.totalRiskAnnual > 0 ? excess / s.totalRiskAnnual : 0,
      treynor: Math.abs(s.beta) > 0.01 ? excess / s.beta : 0,
      ir: s.sigmaEpsilonAnnual > 0 ? s.alphaAnnual / s.sigmaEpsilonAnnual : 0,
    }
  }).sort((a, b) => Math.abs(b.alphaAnnual) - Math.abs(a.alphaAnnual))
})

function rowClass(s: any) {
  if (s.error) return 'row-dim'
  if (s.alphaAnnual > 0.05) return 'row-up'
  if (s.alphaAnnual < -0.05) return 'row-down'
  return ''
}

// ===== ECharts α-β 散点图 =====
function renderChart() {
  if (!chartRef.value || !data.value) return

  // ★ 每次数据变化时销毁旧实例重建，避免状态残留
  if (chart) { chart.dispose(); chart = null }
  chart = echarts.init(chartRef.value)

  const d = data.value
  const stocks = d.stocks.filter((s: any) => !s.error)
  if (stocks.length === 0) return

  const betas = stocks.map((s: any) => s.beta)
  const alphas = stocks.map((s: any) => s.alphaAnnual)
  const absMax = Math.max(...betas.map(Math.abs), 1.5)
  const xMin = -0.2
  const xMax = Math.ceil(absMax * 1.3)
  const yMin = Math.min(-0.4, ...alphas) * 1.1
  const yMax = Math.max(0.4, ...alphas) * 1.1

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const s = stocks[p.dataIndex]
        if (!s) return ''
        return [
          `<strong>${s.name}</strong> (${s.code})`,
          `β: <b>${s.beta.toFixed(3)}</b>`,
          `α(年化): <b>${(s.alphaAnnual * 100).toFixed(2)}%</b>`,
          `R²: ${(s.rSquared * 100).toFixed(1)}%`,
          `t值: ${s.tValue.toFixed(2)}`,
          `非系统风险: ${(s.sigmaEpsilonAnnual * 100).toFixed(1)}%`,
        ].join('<br/>')
      },
    },
    grid: { left: 65, right: 50, top: 25, bottom: 40 },
    xAxis: {
      type: 'value',
      name: 'β (Beta)',
      nameLocation: 'middle',
      nameGap: 30,
      min: xMin,
      max: xMax,
      axisLine: { lineStyle: { color: '#555' } },
      axisTick: { lineStyle: { color: '#555' } },
      axisLabel: { color: '#999', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      name: 'α (年化)',
      nameLocation: 'middle',
      nameGap: 45,
      min: yMin,
      max: yMax,
      axisLine: { lineStyle: { color: '#555' } },
      axisTick: { lineStyle: { color: '#555' } },
      axisLabel: {
        color: '#999', fontSize: 11,
        formatter: (v: number) => (v * 100).toFixed(0) + '%',
      },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } },
    },
    series: [
      // 参考线: β=1 用 markLine
      {
        type: 'scatter',
        data: [],
        z: 0, symbolSize: 0,
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: 'rgba(255,255,255,0.2)', type: 'dashed', width: 1 },
          data: [{ xAxis: 1, label: { show: true, formatter: 'β=1', color: '#666', fontSize: 10, position: 'end' } }],
        },
      },
      // 参考线: α=0 用 markLine  
      {
        type: 'scatter',
        data: [],
        z: 0, symbolSize: 0,
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: 'rgba(255,255,255,0.2)', type: 'dashed', width: 1 },
          data: [{ yAxis: 0, label: { show: true, formatter: 'α=0', color: '#666', fontSize: 10, position: 'end' } }],
        },
      },
      // 股票散点
      {
        name: '个股',
        type: 'scatter',
        data: stocks.map((s: any) => ({
          value: [s.beta, s.alphaAnnual],
          name: s.name,
        })),
        symbolSize: 14,
        itemStyle: { color: '#3370ff', opacity: 0.85 },
        z: 2,
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => (p.data?.name || '').slice(0, 4),
          color: '#ccc', fontSize: 10,
        },
        emphasis: { scale: 1.5 },
      },
      // 组合标记
      ...(portfolioSummary.value ? [{
        name: '当前持仓',
        type: 'scatter' as const,
        data: [[portfolioSummary.value.beta, portfolioSummary.value.alphaAnnual]],
        symbol: 'diamond',
        symbolSize: 18,
        itemStyle: { color: '#f59e0b', borderColor: '#fff', borderWidth: 2 },
        z: 3,
        label: { show: true, position: 'top', formatter: '组合', color: '#f59e0b', fontSize: 12, fontWeight: 'bold' },
      }] : []),
    ],
  })
}

// ===== 生命周期 =====
watch(codesKey, () => { if (codesKey.value) fetchData() }, { immediate: true })
onUnmounted(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.capm-container {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 20px;
}

.capm-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;
}
.capm-title { font-size: 16px; font-weight: 700; margin: 0; }

.capm-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.capm-cards-ratio {
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}

.capm-card {
  background: var(--bg-input);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  text-align: center;
}
.capm-card-label { font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.capm-card-value { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
.capm-card-value.val-up { color: var(--color-up); }
.capm-card-value.val-down { color: var(--color-down); }
.capm-card-value.neutral { color: var(--text-primary); }
.capm-card-sub { font-size: 11px; color: var(--text-secondary); margin-top: 3px; }

.capm-chart { width: 100%; height: 360px; }

.capm-loading, .capm-error { text-align: center; padding: 30px; color: var(--text-secondary); }
.capm-error { color: var(--color-down); }

.capm-table-wrap { margin-top: 16px; }
.capm-table-wrap h4 { font-size: 14px; font-weight: 700; margin-bottom: 8px; }

.capm-table {
  width: 100%; border-collapse: collapse; font-size: 12px;
}
.capm-table th {
  text-align: left; padding: 8px 8px;
  border-bottom: 2px solid var(--border-color);
  color: var(--text-secondary); font-weight: 600; font-size: 11px;
  white-space: nowrap;
}
.capm-table td {
  padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.03);
  vertical-align: middle;
}
.capm-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.capm-table .conclusion-cell { font-size: 11px; line-height: 1.4; }

.name-cell { display: flex; flex-direction: column; }
.stock-name { font-weight: 600; font-size: 13px; }
.stock-code { font-size: 10px; color: var(--text-secondary); font-family: monospace; }

.positive { color: var(--color-up); font-weight: 600; }
.negative { color: var(--color-down); font-weight: 600; }
.bold { font-weight: 700; }

.row-up { background: rgba(34,197,94,0.03); }
.row-down { background: rgba(239,68,68,0.03); }
.row-dim { opacity: 0.4; }
</style>
