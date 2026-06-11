<template>
  <div>
    <!-- Error banner -->
    <div v-if="portfolioStore.error" class="state-message" style="background:rgba(225,82,65,0.08);border:1px solid rgba(225,82,65,0.2);border-radius:var(--radius-md);margin-bottom:16px;">
      <div class="icon">⚠️</div>
      <div class="text">{{ portfolioStore.error }}</div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px;" @click="portfolioStore.error = null">关闭</button>
    </div>

    <!-- Profit Summary Stats -->
    <StatCards :items="statItems" />

    <!-- Action Bar -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn btn-primary" @click="showAddModal = true">
        ➕ 添加持仓
      </button>
      <button class="btn btn-outline" @click="handleRefresh">
        🔄 刷新数据
      </button>
      <div style="margin-left:auto;display:flex;gap:4px;background:var(--bg-input);border-radius:6px;padding:3px;">
        <button
          class="btn btn-ghost btn-sm"
          :style="uiStore.viewMode === 'table' ? 'background:var(--color-accent);color:#fff;' : ''"
          @click="uiStore.setViewMode('table')"
        >📋 表格</button>
        <button
          class="btn btn-ghost btn-sm"
          :style="uiStore.viewMode === 'card' ? 'background:var(--color-accent);color:#fff;' : ''"
          @click="uiStore.setViewMode('card')"
        >🃏 卡片</button>
      </div>
    </div>

    <!-- Portfolio Table -->
    <div style="margin-bottom:20px;">
      <PortfolioTable
        v-if="uiStore.viewMode === 'table'"
        :rows="tableRows"
        @remove="handleRemove"
        @edit="handleEditStart"
        @kline="handleKline"
        @ai-analysis="handleAiAnalysis"
      />
      <!-- Card View -->
      <div v-else class="card-grid">
        <div v-if="tableRows.length === 0" class="state-message" style="grid-column:1/-1;">
          <div class="icon">📋</div>
          <div class="text">暂无持仓，点击上方「添加持仓」开始</div>
        </div>
        <div v-for="row in tableRows" :key="row.id" class="portfolio-card" :style="{ borderTopColor: getChangeColor(row.profit || 0) }">
          <div class="pc-header">
            <div @click="handleKline(row.ts_code, row.name)" style="cursor:pointer;flex:1;">
              <div class="pc-name" style="color:var(--color-accent);">{{ row.name }} <span style="font-size:10px;">↗</span></div>
              <div class="pc-code">{{ row.ts_code }}</div>
            </div>
            <div style="display:flex;gap:2px;align-items:center;">
              <button v-if="!row.aiSummary" class="btn btn-ghost btn-sm" style="padding:2px 5px;font-size:10px;" @click="handleAiAnalysis(row.ts_code, row.name)" title="AI分析">🤖</button>
              <span v-else class="ai-tag" @click="handleAiAnalysis(row.ts_code, row.name)">{{ row.aiSummary }}</span>
              <button class="btn btn-ghost btn-sm" @click="handleEditStart(row)">✏️</button>
              <button class="btn btn-ghost btn-sm" @click="handleRemove(row.id)">🗑️</button>
            </div>
          </div>
          <div class="pc-body">
            <div class="pc-item">
              <span class="pc-label">成本</span>
              <span class="pc-value">{{ formatMoney(row.cost) }}</span>
            </div>
            <div class="pc-item">
              <span class="pc-label">持仓</span>
              <span class="pc-value">{{ row.shares.toLocaleString() }}股</span>
            </div>
            <div class="pc-item">
              <span class="pc-label">最新价</span>
              <span class="pc-value" :style="{ color: getChangeColor(row.change || 0) }">{{ row.close?.toFixed(2) || '-' }}</span>
            </div>
            <div class="pc-item">
              <span class="pc-label">涨跌幅</span>
              <span class="tag" :class="(row.pct_chg ?? 0) > 0 ? 'tag-up' : (row.pct_chg ?? 0) < 0 ? 'tag-down' : 'tag-neutral'">{{ formatPercent(row.pct_chg || 0) }}</span>
            </div>
            <div class="pc-item">
              <span class="pc-label">浮动盈亏</span>
              <span class="pc-value" :style="{ color: getChangeColor(row.profit || 0), fontWeight: 700 }">{{ formatMoney(row.profit || 0) }}</span>
            </div>
            <div class="pc-item">
              <span class="pc-label">盈亏比例</span>
              <span class="tag" :class="(row.profitPct ?? 0) > 0 ? 'tag-up' : (row.profitPct ?? 0) < 0 ? 'tag-down' : 'tag-neutral'">{{ formatPercent(row.profitPct || 0) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="content-grid">
      <div>
        <IndustryPieChart :data="industryData" />
      </div>
      <div class="span-2">
        <CorrelationHeatmap
          :names="correlationNames"
          :matrix="correlationMatrix"
          :high-pairs="portfolioStore.highCorrelationPairs"
          :loading="correlationLoading"
        />
      </div>
    </div>

    <!-- 有效前沿 -->
    <EfficientFrontier
      v-if="portfolioStore.holdings.length >= 2"
      :holdings="frontierHoldings"
    />

    <!-- CAPM 分析 -->
    <CapmAnalysis
      v-if="portfolioStore.holdings.length >= 1"
      :holdings="frontierHoldings"
    />

    <!-- AI Diagnosis -->
    <AiDiagnosis
      :result="portfolioStore.aiDiagnosis"
      :loading="aiLoading"
      @analyze="handleAiDiagnosis"
    />

    <!-- Add/Edit Holding Modal -->
    <AddHoldingModal
      v-if="showAddModal"
      :edit-data="editingHolding"
      @close="showAddModal = false; editingHolding = null"
      @submit="handleAdd"
      @update="handleUpdate"
    />

    <!-- K线弹窗 -->
    <KlinePopup
      v-if="klineTsCode"
      :ts-code="klineTsCode"
      :stock-name="klineStockName"
      :shares="klineShares"
      :cost="klineCost"
      @close="klineTsCode = null"
    />

    <!-- AI分析弹窗 -->
    <AiAnalysisPopup
      v-if="aiTsCode"
      :ts-code="aiTsCode"
      :stock-name="aiStockName"
      :shares="aiShares"
      :cost="aiCost"
      @close="aiTsCode = null"
      @summary="handleAiSummary"
    />
  </div>
</template>

<script setup lang="ts">
import { usePortfolioStore } from '~/stores/portfolio'
import { useUiStore } from '~/stores/ui'
import { formatMoney, formatLargeMoney, formatPercent, getChangeColor } from '~/utils/formatters'
import StatCards from '~/components/common/StatCards.vue'
import PortfolioTable from '~/components/portfolio/PortfolioTable.vue'
import IndustryPieChart from '~/components/portfolio/IndustryPieChart.vue'
import CorrelationHeatmap from '~/components/portfolio/CorrelationHeatmap.vue'
import AiDiagnosis from '~/components/portfolio/AiDiagnosis.vue'
import AddHoldingModal from '~/components/portfolio/AddHoldingModal.vue'
import EfficientFrontier from '~/components/portfolio/EfficientFrontier.vue'
import CapmAnalysis from '~/components/portfolio/CapmAnalysis.vue'
import KlinePopup from '~/components/portfolio/KlinePopup.vue'
import AiAnalysisPopup from '~/components/portfolio/AiAnalysisPopup.vue'

const portfolioStore = usePortfolioStore()
const uiStore = useUiStore()

const showAddModal = ref(false)
const editingHolding = ref<any>(null)
const aiLoading = ref(false)
const correlationLoading = ref(false)

// K线弹窗
const klineTsCode = ref<string | null>(null)
const klineStockName = ref('')
const klineShares = ref(0)
const klineCost = ref(0)

function handleKline(tsCode: string, name: string) {
  klineTsCode.value = tsCode
  klineStockName.value = name
  const h = portfolioStore.holdings.find(x => x.ts_code === tsCode)
  klineShares.value = h?.shares || 0
  klineCost.value = h?.cost || 0
}

// AI分析弹窗
const aiTsCode = ref<string | null>(null)
const aiStockName = ref('')
const aiShares = ref(0)
const aiCost = ref(0)
const aiSummaries = ref<Record<string, string>>({})

function handleAiAnalysis(tsCode: string, name: string) {
  aiTsCode.value = tsCode
  aiStockName.value = name
  const h = portfolioStore.holdings.find(x => x.ts_code === tsCode)
  aiShares.value = h?.shares || 0
  aiCost.value = h?.cost || 0
}

function handleAiSummary(tsCode: string, summary: string) {
  aiSummaries.value[tsCode] = summary
}

async function loadAllAiSummaries() {
  for (const h of portfolioStore.holdings) {
    try {
      const resp = await fetch(`/api/stocks/ai-analysis?ts_code=${h.ts_code}`)
      const json = await resp.json()
      if (json.success && json.data && json.data.summary) {
        aiSummaries.value[h.ts_code] = json.data.summary
      }
    } catch {}
  }
}

// Build stat items from store
const statItems = computed(() => {
  const s = portfolioStore.summary
  if (!s) return [
    { label: '总市值', value: '--' },
    { label: '总盈亏', value: '--' },
    { label: '今日盈亏', value: '--' },
    { label: '持仓数量', value: `${portfolioStore.holdingCount} 只` },
  ]
  return [
    { label: '总市值', value: formatLargeMoney(s.totalMarketValue), colorClass: '' },
    {
      label: '总盈亏',
      value: formatLargeMoney(s.totalProfit),
      sub: formatPercent(s.totalProfitPct),
      colorClass: s.totalProfit >= 0 ? 'up' : 'down',
    },
    {
      label: '今日盈亏',
      value: formatLargeMoney(s.todayProfit),
      sub: formatPercent(s.todayProfitPct),
      colorClass: s.todayProfit >= 0 ? 'up' : 'down',
    },
    { label: '持仓数量', value: `${portfolioStore.holdingCount} 只`, colorClass: '' },
  ]
})

// Build table rows from store
const tableRows = computed(() => {
  const quotes = portfolioStore.quotes
  return portfolioStore.holdings.map(h => {
    const q = quotes[h.ts_code]
    const close = q?.close ?? 0
    const marketValue = close * h.shares
    const costTotal = h.cost * h.shares
    const profit = marketValue - costTotal
    const profitPct = costTotal > 0 ? (profit / costTotal) * 100 : 0
    return {
      id: h.id,
      ts_code: h.ts_code,
      name: h.name,
      cost: h.cost,
      shares: h.shares,
      close: q?.close,
      change: q?.change,
      pct_chg: q?.pct_chg,
      marketValue,
      profit,
      profitPct,
      pe: q?.pe,
      industry: h.industry || q?.industry || '-',
      aiSummary: aiSummaries.value[h.ts_code] || '',
    }
  })
})

// 有效前沿参数（含最新价）
const frontierHoldings = computed(() => {
  return tableRows.value.map(r => ({
    ts_code: r.ts_code, name: r.name,
    shares: r.shares, cost: r.cost,
    close: r.close, marketValue: r.marketValue,
  }))
})

// Industry distribution for pie chart
const industryData = computed(() => {
  const dist = portfolioStore.industryDistribution
  return dist.map(d => ({ name: d.industry, value: d.value }))
})

// Correlation matrix data
const correlationNames = computed(() => {
  return portfolioStore.holdings.map(h => h.name.length > 4 ? h.name.slice(0, 4) : h.name)
})

const correlationMatrix = computed(() => {
  const n = portfolioStore.holdings.length
  if (n < 2) return []
  // Create a mock correlation matrix for demo if no real data
  const m = portfolioStore.correlationMatrix
  if (m.length === 0 && n >= 2) {
    // Generate demo correlation
    const matrix: number[][] = []
    for (let i = 0; i < n; i++) {
      matrix[i] = []
      for (let j = 0; j < n; j++) {
        if (i === j) matrix[i][j] = 1
        else if (j > i) matrix[i][j] = 0
        else {
          // Mock: same industry = high correlation
          const sameInd = portfolioStore.holdings[i].industry === portfolioStore.holdings[j].industry
          matrix[i][j] = sameInd ? 0.6 + Math.random() * 0.35 : 0.1 + Math.random() * 0.4
        }
      }
    }
    return matrix
  }
  // Real matrix - build from pair list
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) matrix[i][i] = 1
  for (const item of m) {
    const i = portfolioStore.holdings.findIndex(h => h.ts_code === item.code1)
    const j = portfolioStore.holdings.findIndex(h => h.ts_code === item.code2)
    if (i >= 0 && j >= 0) {
      matrix[Math.max(i, j)][Math.min(i, j)] = item.correlation
    }
  }
  return matrix
})

async function handleAdd(data: any) {
  portfolioStore.addHolding(data)
  showAddModal.value = false
  await portfolioStore.refreshAll()
}

function handleEditStart(row: any) {
  editingHolding.value = {
    id: row.id,
    ts_code: row.ts_code,
    name: row.name,
    industry: row.industry || '',
    cost: row.cost,
    shares: row.shares,
    buy_date: row.buy_date || new Date().toISOString().slice(0, 10),
  }
  showAddModal.value = true
}

async function handleUpdate(data: any) {
  portfolioStore.updateHolding(data.id, {
    cost: data.cost,
    shares: data.shares,
    buy_date: data.buy_date,
  })
  showAddModal.value = false
  editingHolding.value = null
  await portfolioStore.refreshAll()
}

function handleRemove(id: string) {
  if (confirm('确认删除该持仓？')) {
    portfolioStore.removeHolding(id)
  }
}

async function handleRefresh() {
  await portfolioStore.refreshAll()
}

async function handleAiDiagnosis() {
  aiLoading.value = true
  try {
    await portfolioStore.fetchAiDiagnosis()
  } finally {
    aiLoading.value = false
  }
}

// Page load: 从服务端拉持仓 → 仅在首次无行情数据时拉取
onMounted(async () => {
  await portfolioStore.initFromServer()
  // 加载所有持仓的AI摘要
  loadAllAiSummaries()
  if (portfolioStore.holdings.length > 0 && Object.keys(portfolioStore.quotes).length === 0) {
    await portfolioStore.refreshAll()
    try {
      correlationLoading.value = true
      await portfolioStore.fetchCorrelation()
    } catch {} finally { correlationLoading.value = false }
  }
})
</script>

<style scoped>
/* Card grid for card view */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.portfolio-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-top: 3px solid var(--color-accent);
  border-radius: var(--radius-md);
  padding: 16px;
  transition: all var(--transition);
}
.portfolio-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-1px); }

.pc-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 12px;
}

.pc-name { font-size: 16px; font-weight: 700; }
.pc-code { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }

.pc-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.pc-item {
  display: flex; flex-direction: column; gap: 2px;
}

.pc-label {
  font-size: 11px; color: var(--text-secondary);
}

.pc-value {
  font-size: 14px; font-weight: 600;
}
</style>
