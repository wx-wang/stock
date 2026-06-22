<template>
  <div class="sector-rotation-page">
    <div class="page-header">
      <h1 class="page-title">🔄 行业轮动分析</h1>
      <p class="page-subtitle">基于申万二级行业指数的CAPM分析，辅助行业轮动决策</p>
    </div>

    <!-- 控制栏 -->
    <div class="control-bar">
      <div class="control-group">
        <label>计算周期:</label>
        <select v-model="days" class="select-input" @change="handleRefresh">
          <option :value="30">30日</option>
          <option :value="60">60日</option>
          <option :value="90">90日</option>
          <option :value="120">120日</option>
        </select>
      </div>
      <div class="control-group">
        <label>基准指数:</label>
        <select v-model="indexCode" class="select-input" @change="handleRefresh">
          <option value="000300.SH">沪深300</option>
          <option value="000001.SH">上证指数</option>
          <option value="399001.SZ">深证成指</option>
          <option value="399006.SZ">创业板指</option>
        </select>
      </div>
      <button class="btn btn-primary" @click="handleRefresh" :disabled="loading">
        {{ loading ? `⏳ 计算中(${progressText})...` : '🔄 重新计算' }}
      </button>
      <span v-if="loading" class="loading-hint">分析全部{{ data?.totalCount || '110+' }}个申万二级行业，约需10-15秒</span>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-cards" v-if="data">
      <div class="stat-card">
        <div class="stat-label">分析行业数</div>
        <div class="stat-value">{{ data.analyzedCount }}/{{ data.totalCount }}</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-label">优质防御型(α>0,β<1)</div>
        <div class="stat-value">{{ defensiveQualityCount }} 个</div>
      </div>
      <div class="stat-card highlight-offense">
        <div class="stat-label">优质进攻型(α>0,β>1)</div>
        <div class="stat-value">{{ offensiveQualityCount }} 个</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">显著正α行业</div>
        <div class="stat-value">{{ significantPositiveAlpha }} 个</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">市场年化波动</div>
        <div class="stat-value">{{ (data.marketAnnualVol * 100).toFixed(2) }}%</div>
      </div>
    </div>

    <!-- 散点图 -->
    <SectorScatterChart
      :sectors="data?.sectors || []"
      :index-name="data?.indexName || '沪深300'"
      :days="data?.days || 60"
      :loading="loading"
      :error="error"
    />

    <!-- 数据表格 -->
    <SectorTable :sectors="data?.sectors || []" @show-trend="showTrend" />

    <!-- 轮动策略建议 -->
    <div class="strategy-panel" v-if="data">
      <h3 class="strategy-title">💡 轮动策略建议</h3>
      <div class="strategy-grid">
        <div class="strategy-card q1">
          <div class="strategy-header">
            <span class="strategy-badge">Q1</span>
            <span class="strategy-name">优质防御型</span>
          </div>
          <div class="strategy-desc">高α + 低β · 市场下跌时抗跌，市场上涨时跟涨</div>
          <div class="strategy-sectors" v-if="q1Sectors.length > 0">
            <span v-for="s in q1Sectors.slice(0, 5)" :key="s.ts_code" class="sector-tag">
              {{ s.name }}
            </span>
          </div>
          <div class="strategy-empty" v-else>暂无符合条件的行业</div>
        </div>

        <div class="strategy-card q2">
          <div class="strategy-header">
            <span class="strategy-badge">Q2</span>
            <span class="strategy-name">优质进攻型</span>
          </div>
          <div class="strategy-desc">高α + 高β · 市场上涨时领涨，进攻性强</div>
          <div class="strategy-sectors" v-if="q2Sectors.length > 0">
            <span v-for="s in q2Sectors.slice(0, 5)" :key="s.ts_code" class="sector-tag">
              {{ s.name }}
            </span>
          </div>
          <div class="strategy-empty" v-else>暂无符合条件的行业</div>
        </div>

        <div class="strategy-card q3">
          <div class="strategy-header">
            <span class="strategy-badge">Q3</span>
            <span class="strategy-name">跑输防御型</span>
          </div>
          <div class="strategy-desc">低α + 低β · 防御但跑输市场，需谨慎</div>
          <div class="strategy-sectors" v-if="q3Sectors.length > 0">
            <span v-for="s in q3Sectors.slice(0, 3)" :key="s.ts_code" class="sector-tag warn">
              {{ s.name }}
            </span>
          </div>
          <div class="strategy-empty" v-else>暂无符合条件的行业</div>
        </div>

        <div class="strategy-card q4">
          <div class="strategy-header">
            <span class="strategy-badge">Q4</span>
            <span class="strategy-name">跑输进攻型</span>
          </div>
          <div class="strategy-desc">低α + 高β · 波动大但无超额收益，回避</div>
          <div class="strategy-sectors" v-if="q4Sectors.length > 0">
            <span v-for="s in q4Sectors.slice(0, 3)" :key="s.ts_code" class="sector-tag danger">
              {{ s.name }}
            </span>
          </div>
          <div class="strategy-empty" v-else>暂无符合条件的行业</div>
        </div>
      </div>
    </div>

    <!-- 行业掘金：个股推荐 -->
    <SectorPicks />

    <!-- 拥挤度散点图 -->
    <SectorCrowdingChart
      :sectors="data?.sectors || []"
      :loading="loading"
      :error="error"
    />

    <!-- 行业趋势弹窗 -->
    <SectorTrendPopup
      v-if="trendIndexCode"
      :index-code="trendIndexCode"
      :sector-name="trendSectorName"
      :days="days"
      @close="closeTrend"
    />
  </div>
</template>

<script setup lang="ts">
import SectorScatterChart from '~/components/sector/SectorScatterChart.vue'
import SectorTable from '~/components/sector/SectorTable.vue'
import SectorTrendPopup from '~/components/sector/SectorTrendPopup.vue'

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

interface CapmResponse {
  success: boolean
  data?: {
    indexCode: string
    indexName: string
    days: number
    threshold: number
    marketAnnualVol: number
    sectors: SectorData[]
    totalCount: number
    analyzedCount: number
  }
  error?: string
}

// 状态
const days = ref(60)
const indexCode = ref('000300.SH')
const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<CapmResponse['data'] | null>(null)
const progressText = ref('0%')

// 趋势弹窗
const trendIndexCode = ref<string | null>(null)
const trendSectorName = ref('')

function showTrend(indexCode: string, name: string) {
  trendIndexCode.value = indexCode
  trendSectorName.value = name
}

function closeTrend() {
  trendIndexCode.value = null
  trendSectorName.value = ''
}

// 计算属性 - 四象限分类
const validSectors = computed(() =>
  (data.value?.sectors || []).filter(s => !s.error)
)

const q1Sectors = computed(() =>
  validSectors.value
    .filter(s => s.alphaAnnual > 0 && s.beta <= 1)
    .sort((a, b) => b.alphaAnnual - a.alphaAnnual)
)

const q2Sectors = computed(() =>
  validSectors.value
    .filter(s => s.alphaAnnual > 0 && s.beta > 1)
    .sort((a, b) => b.alphaAnnual - a.alphaAnnual)
)

const q3Sectors = computed(() =>
  validSectors.value
    .filter(s => s.alphaAnnual <= 0 && s.beta <= 1)
    .sort((a, b) => a.alphaAnnual - b.alphaAnnual)
)

const q4Sectors = computed(() =>
  validSectors.value
    .filter(s => s.alphaAnnual <= 0 && s.beta > 1)
    .sort((a, b) => a.alphaAnnual - b.alphaAnnual)
)

// 统计
const defensiveQualityCount = computed(() => q1Sectors.value.length)
const offensiveQualityCount = computed(() => q2Sectors.value.length)
const significantPositiveAlpha = computed(() =>
  validSectors.value.filter(s => s.significant && s.alphaAnnual > 0).length
)

// 获取数据
async function fetchData(forceRefresh = false) {
  loading.value = true
  progressText.value = '0%'
  error.value = null
  try {
    const resp = await fetch(
      `/api/sectors/capm?days=${days.value}&index_code=${indexCode.value}&threshold=2.0${forceRefresh ? '&force=true' : ''}`
    )
    const json: CapmResponse = await resp.json()
    if (!json.success || !json.data) {
      error.value = json.error || '数据获取失败'
      return
    }
    data.value = json.data
  } catch (e: any) {
    error.value = e.message || '网络错误'
  } finally {
    loading.value = false
    progressText.value = '0%'
  }
}

function handleRefresh() {
  fetchData(true)
}

// 页面加载时：仅首次无数据时自动获取
onMounted(() => {
  if (!data.value) {
    fetchData()
  }
})
</script>

<style scoped>
.sector-rotation-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 8px 0;
}

.page-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* 控制栏 */
.control-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.loading-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 8px;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-group label {
  font-size: 13px;
  color: var(--text-secondary);
}

.select-input {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.select-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

/* 统计卡片 */
.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  text-align: center;
}

.stat-card.highlight {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.05);
}

.stat-card.highlight-offense {
  border-color: rgba(6, 182, 212, 0.3);
  background: rgba(6, 182, 212, 0.05);
}

.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.stat-value {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* 策略面板 */
.strategy-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-top: 20px;
}

.strategy-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 16px 0;
}

.strategy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.strategy-card {
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.strategy-card.q1 {
  background: rgba(34, 197, 94, 0.05);
  border-color: rgba(34, 197, 94, 0.2);
}

.strategy-card.q2 {
  background: rgba(6, 182, 212, 0.05);
  border-color: rgba(6, 182, 212, 0.2);
}

.strategy-card.q3 {
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.2);
}

.strategy-card.q4 {
  background: rgba(249, 115, 22, 0.05);
  border-color: rgba(249, 115, 22, 0.2);
}

.strategy-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.strategy-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.q1 .strategy-badge { background: #22c55e; }
.q2 .strategy-badge { background: #06b6d4; }
.q3 .strategy-badge { background: #ef4444; }
.q4 .strategy-badge { background: #f97316; }

.strategy-name {
  font-weight: 700;
  font-size: 14px;
}

.strategy-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.strategy-sectors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sector-tag {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.sector-tag.warn {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.sector-tag.danger {
  background: rgba(249, 115, 22, 0.15);
  color: #f97316;
}

.strategy-empty {
  font-size: 12px;
  color: var(--text-secondary);
  font-style: italic;
}

@media (max-width: 768px) {
  .strategy-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .strategy-card {
    padding: 12px;
  }
}
</style>
