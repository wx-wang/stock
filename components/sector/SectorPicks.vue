<!-- SectorPicks.vue — 行业掘金：基于行业轮动推荐个股组合 -->
<template>
  <div class="sector-picks">
    <h3 class="picks-title">⛏️ 行业掘金 · 个股组合推荐</h3>
    <p class="picks-subtitle">基于 {{ quadrants.join('+') }} 象限优质行业 × 多因子打分</p>

    <!-- Loading -->
    <div v-if="loading" class="picks-loading">
      <span class="spinner"></span> 正在拉取成分股并打分...
    </div>

    <!-- Error -->
    <div v-else-if="error" class="picks-error">
      {{ error }}
      <div class="picks-error-hint">
        <p>请先访问以下页面建立数据缓存：</p>
        <p>1. <NuxtLink to="/sector-rotation">行业轮动</NuxtLink>（等待 CAPM 计算完成）</p>
        <p>2. <NuxtLink to="/screener-overview">股票一览</NuxtLink>（等待数据加载完成）</p>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="!picks.length" class="picks-empty">暂无推荐，请检查条件</div>

    <!-- Results -->
    <template v-else>
      <!-- Summary bar -->
      <div class="picks-summary">
        <div class="summary-item">
          <span class="summary-label">覆盖行业</span>
          <span class="summary-value">{{ coveredSectors.length }}个</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">精选个股</span>
          <span class="summary-value">{{ picks.length }}只</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">推荐象限</span>
          <span class="summary-value">{{ quadrants.join('+') }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">日期</span>
          <span class="summary-value">{{ resultDate }}</span>
        </div>
        <button class="btn btn-sm" @click="refresh" :disabled="loading">🔄 刷新</button>
      </div>

      <!-- Pie chart area (simple bar chart of weights) -->
      <div class="picks-chart-area">
        <div class="weight-bar-wrap" v-for="p in visiblePicks" :key="p.ts_code">
          <div class="weight-bar-label">
            <span class="weight-bar-name">{{ p.name }}</span>
            <span class="weight-bar-pct">{{ p.weight }}%</span>
          </div>
          <div class="weight-bar-track">
            <div
              class="weight-bar-fill"
              :style="{ width: p.weight + '%', background: barColor(p) }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Table -->
      <div style="overflow-x:auto;">
        <table class="picks-table">
          <thead>
            <tr>
              <th>#</th>
              <th>股票</th>
              <th class="hide-mobile">行业</th>
              <th class="num">权重</th>
              <th class="num">总分</th>
              <th class="num hide-mobile">动量</th>
              <th class="num hide-mobile">估值</th>
              <th class="num hide-mobile">共识</th>
              <th class="num hide-mobile">成长</th>
              <th class="num hide-mobile">适配</th>
              <th class="num">股价</th>
              <th class="num">PE</th>
              <th class="num hide-mobile">终局PE</th>
              <th class="num">估值空间</th>
              <th>理由</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in picks" :key="p.ts_code" :class="{ 'row-top3': i < 3 }">
              <td class="rank">{{ i + 1 }}</td>
              <td class="stock-name">{{ p.name }}<span class="code-sub">{{ fmtCode(p.ts_code) }}</span></td>
              <td class="hide-mobile sector-name">{{ p.sector }}</td>
              <td class="num weight-val">{{ p.weight }}%</td>
              <td class="num score-val" :style="{ color: scoreColor(p.totalScore) }">{{ p.totalScore }}</td>
              <td class="num hide-mobile">{{ p.scoreMomentum }}</td>
              <td class="num hide-mobile">{{ p.scoreValuation }}</td>
              <td class="num hide-mobile">{{ p.scoreConsensus }}</td>
              <td class="num hide-mobile">{{ p.scoreGrowth }}</td>
              <td class="num hide-mobile">{{ p.scoreFit }}</td>
              <td class="num">{{ p.close?.toFixed(2) }}</td>
              <td class="num">{{ p.peTtm?.toFixed(1) }}</td>
              <td class="num hide-mobile">{{ p.terminalPe > 0 ? p.terminalPe.toFixed(1) : '--' }}</td>
              <td class="num" :style="{ color: p.dcfUpside > 0 ? 'var(--color-up)' : 'var(--color-down)' }">
                {{ p.dcfUpside > 0 ? '+' : '' }}{{ p.dcfUpside.toFixed(1) }}%
              </td>
              <td class="reason">{{ reasonShort(p) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
export interface SectorPick {
  ts_code: string; name: string; sector: string
  weight: number; totalScore: number
  scoreMomentum: number; scoreValuation: number
  scoreConsensus: number; scoreGrowth: number; scoreFit: number
  close: number; peTtm: number; dcfUpside: number; targetUpside: number
  peg: number; goldenCount12m: number; isGoldenRecent: boolean
  buyRating: number; fy2Growth: number; terminalPe: number
  sectorAlpha: number; sectorBeta: number
}

interface SectorPicksResult {
  success: boolean; error?: string
  _date: string; quadrants: string[]
  sectors: { name: string; code: string; alphaAnnual: number; beta: number }[]
  picks: SectorPick[]
}

const loading = ref(false)
const error = ref('')
const result = ref<SectorPicksResult | null>(null)

const quadrants = computed(() => result.value?.quadrants || ['Q1', 'Q2'])
const picks = computed(() => result.value?.picks || [])
const resultDate = computed(() => result.value?._date || '')
const coveredSectors = computed(() => {
  const set = new Set(picks.value.map(p => p.sector))
  return [...set]
})
const visiblePicks = computed(() => picks.value.slice(0, 6))

function barColor(p: SectorPick): string {
  if (p.totalScore >= 0.7) return '#22c55e'
  if (p.totalScore >= 0.5) return '#06b6d4'
  return '#3370FF'
}

function scoreColor(s: number): string {
  if (s >= 0.7) return '#22c55e'
  if (s >= 0.5) return '#06b6d4'
  return '#3370FF'
}

function fmtCode(code: string): string {
  return code?.replace(/\.(SH|SZ)$/, '') || ''
}

function reasonShort(p: SectorPick): string {
  const parts: string[] = []
  if (p.goldenCount12m >= 3) parts.push('🏅')
  if (p.dcfUpside > 30) parts.push('低估')
  else if (p.dcfUpside > 15) parts.push('有空间')
  if (p.fy2Growth > 20) parts.push('高增长')
  if (p.buyRating >= 10) parts.push('机构看好')
  if (p.peg > 0 && p.peg < 1) parts.push('低PEG')
  if (p.isGoldenRecent) parts.push('当月金股')
  return parts.length ? parts.join('·') : '综合推荐'
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<SectorPicksResult>('/api/stocks/sector-picks', {
      query: { days: 60, quadrant: 'Q1,Q2', count: 10 }
    })
    if (!res.success) { error.value = res.error || '加载失败'; return }
    result.value = res
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || '请求失败'
  } finally { loading.value = false }
}

onMounted(() => refresh())
</script>

<style scoped>
.sector-picks {
  margin-top: 24px;
  padding: 16px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.picks-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}
.picks-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.picks-loading, .picks-empty, .picks-error {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}
.picks-error { color: var(--color-down); }
.picks-error-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.picks-error-hint a {
  color: var(--color-accent);
  text-decoration: underline;
}

.spinner {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid var(--text-secondary);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 4px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.picks-summary {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: rgba(51,112,255,0.06);
  border-radius: 6px;
}
.summary-item { display: flex; flex-direction: column; gap: 2px; }
.summary-label { font-size: 11px; color: var(--text-secondary); }
.summary-value { font-size: 14px; font-weight: 700; }
.btn { margin-left: auto; }

/* Weight bars */
.picks-chart-area {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.weight-bar-wrap { display: flex; flex-direction: column; gap: 2px; }
.weight-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.weight-bar-name { font-weight: 600; }
.weight-bar-pct { color: var(--text-secondary); }
.weight-bar-track {
  height: 8px;
  background: rgba(128,128,128,0.12);
  border-radius: 4px;
  overflow: hidden;
}
.weight-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

/* Table */
.picks-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.picks-table th {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.picks-table th.num { text-align: right; }
.picks-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-light);
  vertical-align: middle;
}
.picks-table td.num { text-align: right; font-family: monospace; }
.picks-table .row-top3 { background: rgba(34,197,94,0.04); }
.picks-table .rank { font-weight: 700; color: var(--text-secondary); text-align: center; }
.picks-table .stock-name { font-weight: 600; white-space: nowrap; }
.picks-table .code-sub {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 400;
}
.picks-table .sector-name { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.picks-table .weight-val { font-weight: 700; }
.picks-table .score-val { font-weight: 700; }
.picks-table .reason { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }

@media (max-width: 768px) {
  .sector-picks { padding: 12px; }
  .picks-summary { gap: 10px; padding: 8px 10px; }
  .picks-table th, .picks-table td { padding: 6px 8px; font-size: 11px; }
  .picks-table .code-sub { font-size: 9px; }
}
</style>
