<template>
  <div class="trend-analysis-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">📈 趋势分析</h1>
      <p class="page-subtitle">全市场趋势扫描，辅助择时与方向判断</p>
    </div>

    <!-- 列表视图 -->
    <div v-if="view === 'list'" class="view-container">
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span class="loading-text">正在加载趋势数据...</span>
      </div>
      <div v-else-if="loadError" class="error-state">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ loadError }}</span>
        <button class="btn btn-outline" @click="fetchBatch">重试</button>
      </div>
      <TrendTable
        v-else
        :stocks="stocks"
        @select="handleSelect"
      />

      <!-- 指数趋势卡片 -->
      <div v-if="!loading && !loadError" class="indices-section">
        <h2 class="section-title">📊 大盘指数趋势</h2>
        <div class="indices-grid">
          <div
            v-for="idx in indices"
            :key="idx.code"
            class="index-card"
            :class="{ 'has-error': idx.error }"
            @click="idx.error ? null : handleIndexClick(idx)"
          >
            <div class="index-name">{{ idx.name }}</div>
            <div class="index-code">{{ idx.code }}</div>
            <div class="index-price">{{ idx.close?.toFixed(2) || '--' }}</div>
            <div class="index-temp" v-if="!idx.error">
              <span class="temp-badge" :style="{ color: getTempColor(idx.temperature), background: getTempBg(idx.temperature) }">
                {{ idx.temperature || '--' }}
              </span>
              <span class="temp-jieqi" v-if="idx.jieqi">{{ idx.jieqi }} {{ idx.jieqiDays }}d</span>
            </div>
            <div class="index-spreads" v-if="!idx.error">
              <span class="spread-label">20↔60</span>
              <span :class="['spread-val', (idx.atrRatio ?? 0) > 3 ? 'spread-hot' : '']">
                {{ idx.spread_20_60 > 0 ? '+' : '' }}{{ idx.spread_20_60 }}%
              </span>
            </div>
            <div class="index-error" v-else>{{ idx.error }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情视图 -->
    <div v-if="view === 'detail'" class="view-container">
      <div class="detail-header">
        <button class="back-btn" @click="goBack">
          <span class="back-arrow">&larr;</span>
          <span>返回列表</span>
        </button>
        <div class="detail-title" v-if="selectedStock">
          <span class="stock-code">{{ selectedStock.code }}</span>
          <span class="stock-name">{{ selectedStock.name }}</span>
        </div>
      </div>

      <div v-if="detailLoading" class="loading-state">
        <div class="spinner"></div>
        <span class="loading-text">正在加载 {{ selectedStock?.name }} 的详细趋势...</span>
      </div>
      <div v-else-if="detailError" class="error-state">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ detailError }}</span>
        <button class="btn btn-outline" @click="selectedStock && fetchDetail(selectedStock)">重试</button>
      </div>
      <TrendChart
        v-else-if="detailData"
        :series="detailData.series || []"
        :summary="detailData.summary"
        :code="detailData.code || selectedStock?.code || ''"
        :name="detailData.name || selectedStock?.name || ''"
        :loading="detailLoading"
        :backtest="detailData.backtest"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '~/stores/ui'

const uiStore = useUiStore()

interface StockSummary {
  code: string
  name: string
  close: number
  score: number
  temperature: string
  tempLabel: string
  jieqi: string
  jieqiDays: number
  rightDays: number
  strength: number
  spread_20_60: number
  atrRatio: number
  ma5: number
  ma10: number
  ma20: number
  ma60: number
}

interface BatchResult {
  success: boolean
  total: number
  stocks: StockSummary[]
}

// 视图状态
const view = ref<'list' | 'detail'>('list')
const stocks = ref<StockSummary[]>([])
const selectedStock = ref<StockSummary | null>(null)
const detailData = ref<any>(null)
const loading = ref(false)
const detailLoading = ref(false)
const loadError = ref<string | null>(null)
const detailError = ref<string | null>(null)

// 指数数据
interface IndexTrend {
  code: string
  fullCode: string
  name: string
  close: number
  score: number
  temperature: string
  jieqi: string | null
  jieqiDays: number
  spread_20_60: number
  atrRatio: number
  error?: string
}
const indices = ref<IndexTrend[]>([])

// 温度辅助
const TEMP_COLORS: Record<string, string> = {
  '沸': '#C94B3D', '热': '#D9824A', '温': '#B8872D', '平': '#9D917E', '凉': '#6F8FA3', '寒': '#456B8F',
}
const TEMP_BGS: Record<string, string> = {
  '沸': 'rgba(212,56,13,0.12)', '热': 'rgba(225,82,65,0.12)', '温': 'rgba(245,200,66,0.12)',
  '平': 'rgba(144,147,153,0.10)', '凉': 'rgba(64,169,255,0.12)', '寒': 'rgba(51,112,255,0.12)',
}
function getTempColor(t: string) { return TEMP_COLORS[t] || '#909399' }
function getTempBg(t: string) { return TEMP_BGS[t] || 'rgba(144,147,153,0.1)' }

// 获取批量股票列表
async function fetchBatch() {
  loading.value = true
  loadError.value = null
  try {
    const resp = await fetch('/api/trend/batch')
    const json: BatchResult = await resp.json()
    if (!json.success) {
      loadError.value = '获取趋势数据失败'
      return
    }
    stocks.value = json.stocks || []
  } catch (e: any) {
    loadError.value = e.message || '网络错误'
  } finally {
    loading.value = false
  }
}

// 获取单只股票详情（type: 'stock' | 'index'）
async function fetchDetail(stock: StockSummary, type: string = 'stock') {
  detailLoading.value = true
  detailError.value = null
  try {
    const resp = await fetch(`/api/trend/analyze?code=${encodeURIComponent(stock.code)}&days=250&type=${type}`)
    const json = await resp.json()
    if (!json.success) {
      detailError.value = json.error || '获取分析数据失败'
      return
    }
    detailData.value = json.data || json
  } catch (e: any) {
    detailError.value = e.message || '网络错误'
  } finally {
    detailLoading.value = false
  }
}

// 获取指数趋势
async function fetchIndices() {
  try {
    const res = await $fetch<{ success: boolean; indices: IndexTrend[] }>('/api/trend/indices')
    indices.value = res.indices || []
  } catch {
    // 静默失败，指数不是核心功能
  }
}

// 选中某只股票
function handleSelect(stock: StockSummary) {
  selectedStock.value = stock
  view.value = 'detail'
  detailData.value = null
  fetchDetail(stock)
}

// 点击指数 → 复用现有详情视图（用 analyze API）
async function handleIndexClick(idx: IndexTrend) {
  // 构造一个 StockSummary 类型的对象给 fetchDetail
  const fakeStock: StockSummary = {
    code: idx.fullCode || idx.code,  // 用带后缀的完整代码
    name: idx.name,
    close: idx.close,
    score: idx.score,
    temperature: idx.temperature,
    jieqi: idx.jieqi,
    jieqiDays: idx.jieqiDays,
    rightDays: 0,
    strength: 0,
    spread_20_60: idx.spread_20_60,
    atrRatio: idx.atrRatio,
    ma5: 0, ma10: 0, ma20: 0, ma60: 0,
    entrySignal: false, exitSignal: false,
    tempLabel: idx.temperature,
  }
  selectedStock.value = fakeStock
  view.value = 'detail'
  detailData.value = null
  fetchDetail(fakeStock, 'index')
}

// 返回列表
function goBack() {
  view.value = 'list'
  selectedStock.value = null
  detailData.value = null
  detailError.value = null
}

// 页面挂载时加载
onMounted(() => {
  uiStore.setActiveNav('trend')
  fetchBatch()
  fetchIndices()
})
</script>

<style scoped>
.trend-analysis-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

/* 页面标题 */
.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 8px 0;
  background: linear-gradient(135deg, var(--color-accent), #6B5BFF);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.page-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* 视图容器 + 动画 */
.view-container {
  animation: fadeSlideIn 0.35s ease;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 详情页头 */
.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.back-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: rgba(51, 112, 255, 0.06);
}

.back-arrow {
  font-size: 16px;
  line-height: 1;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stock-code {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent);
  background: rgba(51, 112, 255, 0.1);
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
}

.stock-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 14px;
  color: var(--text-secondary);
}

/* 错误状态 */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  text-align: center;
}

.error-icon {
  font-size: 32px;
}

.error-text {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 400px;
}

/* ── 指数趋势卡片 ─────────────────────────────────── */
.indices-section {
  margin-top: 28px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.indices-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.index-card {
  background: var(--bg-card, rgba(18, 22, 30, 0.6));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.index-card:hover {
  border-color: var(--color-accent, #4a9eff);
  transform: translateY(-2px);
}

.index-card.has-error {
  opacity: 0.5;
  cursor: default;
}

.index-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.index-code {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: monospace;
  margin-bottom: 8px;
}

.index-price {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
  tabular-nums: fixed;
}

.index-temp {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.temp-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.temp-jieqi {
  font-size: 11px;
  color: var(--text-secondary);
}

.index-spreads {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.spread-label {
  color: var(--text-secondary);
}

.spread-val {
  color: #4CAF50;
  font-weight: 600;
}

.spread-val.spread-hot {
  color: #D4380D;
}

.index-error {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

@media (max-width: 768px) {
  .indices-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .indices-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
