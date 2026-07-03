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
        :data="detailData"
        :stock="selectedStock"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
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

// 获取单只股票详情
async function fetchDetail(stock: StockSummary) {
  detailLoading.value = true
  detailError.value = null
  try {
    const resp = await fetch(`/api/trend/analyze?code=${encodeURIComponent(stock.code)}&days=250`)
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

// 选中某只股票
function handleSelect(stock: StockSummary) {
  selectedStock.value = stock
  view.value = 'detail'
  detailData.value = null
  fetchDetail(stock)
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
  fetchBatch()
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
</style>
