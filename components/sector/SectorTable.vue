<template>
  <div class="sector-table-container">
    <div class="sector-table-header">
      <h3 class="sector-table-title">📊 申万二级行业 CAPM 分析表</h3>
      <div class="sector-table-actions">
        <button
          v-for="opt in sortOptions"
          :key="opt.key"
          class="btn btn-ghost btn-sm"
          :class="{ active: sortKey === opt.key }"
          @click="setSort(opt.key)"
        >
          {{ opt.label }}
          <span v-if="sortKey === opt.key">{{ sortDesc ? '↓' : '↑' }}</span>
        </button>
      </div>
    </div>

    <div class="sector-table-wrap">
      <div style="overflow-x:auto;">
      <table class="sector-table">
        <thead>
          <tr>
            <th class="name-col">行业名称</th>
            <th class="code-col hide-mobile">代码</th>
            <th class="num-col" @click="setSort('rps')">
              RPS
              <span v-if="sortKey === 'rps'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col" @click="setSort('cumulativeReturn')">
              区间收益
              <span v-if="sortKey === 'cumulativeReturn'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col" @click="setSort('beta')">
              β
              <span v-if="sortKey === 'beta'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col" @click="setSort('alphaAnnual')">
              α(年化)
              <span v-if="sortKey === 'alphaAnnual'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col" @click="setSort('alphaMomentum')">
              α动量
              <span v-if="sortKey === 'alphaMomentum'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col" @click="setSort('rSquared')">
              R²
              <span v-if="sortKey === 'rSquared'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col hide-mobile" @click="setSort('tValue')">
              t值
              <span v-if="sortKey === 'tValue'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col hide-mobile" @click="setSort('annualVol')">
              年化波动
              <span v-if="sortKey === 'annualVol'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col" @click="setSort('sharpe')">
              Sharpe
              <span v-if="sortKey === 'sharpe'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="num-col hide-mobile" @click="setSort('crowdingPct')">
              🔥 拥挤
              <span v-if="sortKey === 'crowdingPct'" class="sort-indicator">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="conclusion-col">结论</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in sortedSectors"
            :key="s.ts_code"
            :class="getRowClass(s)"
          >
            <td class="name-col">
              <span class="sector-name clickable" @click.stop="$emit('showTrend', s.ts_code, s.name)">
                {{ s.name }} <span class="expand-icon">↗</span>
              </span>
            </td>
            <td class="code-col hide-mobile">{{ s.ts_code }}</td>
            <td class="num-col" :class="getRpsClass(s.rps)">
              {{ s.rps ?? '-' }}
            </td>
            <td class="num-col" :class="getReturnClass(s.cumulativeReturn)">
              {{ s.cumulativeReturn != null ? (s.cumulativeReturn * 100).toFixed(2) + '%' : '-' }}
            </td>
            <td class="num-col" :class="getBetaClass(s.beta)">
              {{ s.beta.toFixed(3) }}
            </td>
            <td class="num-col" :class="getAlphaClass(s.alphaAnnual)">
              {{ (s.alphaAnnual * 100).toFixed(2) }}%
              <span v-if="s.significant" class="significant-mark">*</span>
            </td>
            <td class="num-col" :class="getAlphaMomClass(s.alphaMomentum)">
              <span v-if="s.alphaMomentum != null">{{ (s.alphaMomentum * 100).toFixed(2) }}%</span>
              <span v-else>-</span>
              <span v-if="s.alphaMomentumSig" class="significant-mark">*</span>
              <span class="alpha-mom-t">t={{ s.alphaMomentumT?.toFixed(1) }}</span>
            </td>
            <td class="num-col">
              {{ (s.rSquared * 100).toFixed(1) }}%
            </td>
            <td class="num-col hide-mobile" :class="s.significant ? 'significant' : ''">
              {{ s.tValue.toFixed(2) }}
            </td>
            <td class="num-col hide-mobile">
              {{ s.annualVol ? (s.annualVol * 100).toFixed(2) + '%' : '-' }}
            </td>
            <td class="num-col" :class="getSharpeClass(s.sharpe)">
              {{ s.sharpe?.toFixed(3) || '-' }}
            </td>
            <td class="num-col hide-mobile" :style="crowdingStyle(s)">
              {{ crowdingLabel(s) }}
            </td>
            <td class="conclusion-col">
              <span class="conclusion-text">{{ s.conclusion }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div class="sector-table-footer">
      <div class="footer-stats">
        <span>共 {{ sectors.length }} 个行业</span>
        <span class="divider">|</span>
        <span>RPS≥80: {{ rpsHighCount }} 个</span>
        <span class="divider">|</span>
        <span>显著α: {{ significantCount }} 个</span>
        <span class="divider">|</span>
        <span>高β(>1): {{ highBetaCount }} 个</span>
        <span class="divider">|</span>
        <span>高Sharpe(>0.5): {{ highSharpeCount }} 个</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
  cumulativeReturn?: number
  rps?: number
  tradingDays: number
  conclusion?: string
  error?: string
  alphaMomentum?: number     // α 年化斜率
  alphaMomentumT?: number    // 斜率 t 值
  alphaMomentumSig?: boolean // |t|≥2
  crowdingPct?: number       // 拥挤度 (0~100分位)
  crowdingChange?: number    // 5日拥挤度变化
}

const props = defineProps<{
  sectors: SectorData[]
}>()
defineEmits<{ showTrend: [indexCode: string, name: string] }>()

// 排序选项
const sortOptions = [
  { key: 'rps', label: 'RPS' },
  { key: 'cumulativeReturn', label: '收益' },
  { key: 'alphaAnnual', label: 'α' },
  { key: 'alphaMomentum', label: 'α动量' },
  { key: 'beta', label: 'β' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'rSquared', label: 'R²' },
]

const sortKey = ref('rps')
const sortDesc = ref(true)

function setSort(key: string) {
  if (sortKey.value === key) {
    sortDesc.value = !sortDesc.value
  } else {
    sortKey.value = key
    sortDesc.value = true
  }
}

// 排序后的数据
const sortedSectors = computed(() => {
  const valid = props.sectors.filter(s => !s.error)
  return [...valid].sort((a, b) => {
    const aVal = (a as any)[sortKey.value] ?? 0
    const bVal = (b as any)[sortKey.value] ?? 0
    return sortDesc.value ? bVal - aVal : aVal - bVal
  })
})

// 统计
const rpsHighCount = computed(() =>
  props.sectors.filter(s => (s.rps ?? 0) >= 80).length
)
const significantCount = computed(() =>
  props.sectors.filter(s => s.significant && s.alphaAnnual > 0).length
)
const highBetaCount = computed(() =>
  props.sectors.filter(s => s.beta > 1).length
)
const highSharpeCount = computed(() =>
  props.sectors.filter(s => (s.sharpe || 0) > 0.5).length
)

// 样式类
function getRowClass(s: SectorData) {
  if (s.error) return 'row-error'
  if (s.alphaAnnual > 0.05 && s.beta <= 1) return 'row-q1'
  if (s.alphaAnnual > 0.05 && s.beta > 1) return 'row-q2'
  if (s.alphaAnnual < -0.05 && s.beta <= 1) return 'row-q3'
  if (s.alphaAnnual < -0.05 && s.beta > 1) return 'row-q4'
  return ''
}

function getBetaClass(beta: number) {
  if (beta > 1.3) return 'beta-high'
  if (beta > 0.9) return 'beta-mid'
  if (beta > 0.5) return 'beta-low'
  return 'beta-reverse'
}

function getAlphaClass(alpha: number) {
  if (alpha > 0.05) return 'alpha-pos'
  if (alpha < -0.05) return 'alpha-neg'
  return ''
}

function getAlphaMomClass(mom?: number) {
  if (mom == null) return ''
  if (mom > 0.02) return 'alpha-pos'
  if (mom < -0.02) return 'alpha-neg'
  return ''
}

function getSharpeClass(sharpe?: number) {
  if (!sharpe) return ''
  if (sharpe > 1) return 'sharpe-high'
  if (sharpe > 0.5) return 'sharpe-mid'
  if (sharpe < 0) return 'sharpe-low'
  return ''
}

function crowdingLabel(s: SectorData): string {
  const pct = s.crowdingPct ?? 0
  if (pct === 0) return '--'
  const chg = s.crowdingChange ?? 0
  const arrow = chg > 10 ? '↑' : chg < -10 ? '↓' : ''
  return `${pct}${arrow}`
}

function crowdingStyle(s: SectorData): Record<string, string> {
  const pct = s.crowdingPct ?? 0
  if (pct === 0) return {}
  if (pct >= 80) return { color: '#E15241', fontWeight: '700' }
  if (pct >= 60) return { color: '#F0A030', fontWeight: '600' }
  return { color: '#22AB94' }
}

function getRpsClass(rps?: number) {
  if (rps == null) return ''
  if (rps >= 90) return 'rps-hot'
  if (rps >= 80) return 'rps-warm'
  if (rps >= 60) return 'rps-mid'
  if (rps >= 40) return 'rps-cool'
  return 'rps-cold'
}

function getReturnClass(ret?: number) {
  if (ret == null) return ''
  if (ret > 0.1) return 'return-hot'
  if (ret > 0.03) return 'return-warm'
  if (ret < -0.05) return 'return-cold'
  return ''
}
</script>

<style scoped>
.sector-table-container {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 20px;
}

.sector-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.sector-table-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}

.sector-table-actions {
  display: flex;
  gap: 4px;
}

.sector-table-actions .btn {
  font-size: 11px;
  padding: 4px 10px;
}

.sector-table-actions .btn.active {
  background: var(--color-accent);
  color: #fff;
}

.sector-table-wrap {
  overflow-x: auto;
  max-height: 600px;
  overflow-y: auto;
}

.sector-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.sector-table th {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 2px solid var(--border-color);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  position: sticky;
  top: 0;
  background: var(--bg-card);
  z-index: 1;
}

.sector-table th:hover {
  color: var(--text-primary);
}

.sector-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  vertical-align: middle;
}

.sector-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.name-col {
  min-width: 120px;
}

.code-col {
  font-family: monospace;
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.num-col {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.conclusion-col {
  min-width: 200px;
  font-size: 11px;
}

.sector-name {
  font-weight: 600;
}

.sector-name.clickable {
  cursor: pointer;
  color: var(--color-accent, #3370ff);
  transition: color 0.15s;
}

.sector-name.clickable:hover {
  color: #5b8eff;
  text-decoration: underline;
}

.expand-icon {
  font-size: 10px;
  opacity: 0;
  transition: opacity 0.15s;
}

.sector-name.clickable:hover .expand-icon {
  opacity: 1;
}

.sort-indicator {
  margin-left: 4px;
  color: var(--color-accent);
}

.significant-mark {
  color: var(--color-up);
  font-weight: 700;
  margin-left: 2px;
}

.alpha-mom-t {
  display: block;
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 1px;
}

.conclusion-text {
  color: var(--text-secondary);
  line-height: 1.4;
}

/* 行样式 */
.row-q1 { background: rgba(34, 197, 94, 0.05); }
.row-q2 { background: rgba(6, 182, 212, 0.05); }
.row-q3 { background: rgba(239, 68, 68, 0.05); }
.row-q4 { background: rgba(249, 115, 22, 0.05); }
.row-error { opacity: 0.4; }

/* Beta样式 */
.beta-high { color: #ef4444; font-weight: 600; }
.beta-mid { color: #f97316; }
.beta-low { color: #22c55e; }
.beta-reverse { color: #888; }

/* Alpha样式 */
.alpha-pos { color: #22c55e; font-weight: 600; }
.alpha-neg { color: #ef4444; font-weight: 600; }

/* Sharpe样式 */
.sharpe-high { color: #22c55e; font-weight: 600; }
.sharpe-mid { color: #06b6d4; }
.sharpe-low { color: #ef4444; }

/* RPS样式 */
.rps-hot { color: #ef4444; font-weight: 700; }
.rps-warm { color: #f97316; font-weight: 600; }
.rps-mid { color: #facc15; }
.rps-cool { color: #6b7280; }
.rps-cold { color: #22c55e; }

/* 累计收益样式 */
.return-hot { color: #ef4444; font-weight: 600; }
.return-warm { color: #f97316; }
.return-cold { color: #22c55e; }

.significant {
  font-weight: 700;
  color: var(--color-accent);
}

/* Footer */
.sector-table-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.footer-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.divider {
  color: var(--border-color);
}
</style>
