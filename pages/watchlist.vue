<template>
  <div>
    <div v-if="wlStore.error" class="state-message" style="background:rgba(225,82,65,0.08);border:1px solid rgba(225,82,65,0.2);border-radius:8px;margin-bottom:16px;">
      <div class="icon">⚠️</div>
      <div class="text">{{ wlStore.error }}</div>
    </div>

    <!-- 操作栏 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn btn-primary" @click="showAddModal = true">➕ 添加自选股</button>
      <button class="btn btn-outline" @click="wlStore.refreshQuotes" :disabled="wlStore.loading">
        {{ wlStore.loading ? '⏳' : '🔄' }} 刷新行情
      </button>
      <span v-if="selectedCodes.length > 0" style="margin-left:auto;">
        <button class="btn btn-primary" @click="runAnalysis" :disabled="analysisLoading">
          {{ analysisLoading ? '⏳ 分析中...' : `📊 分析已选 (${selectedCodes.length})` }}
        </button>
        <button class="btn btn-ghost btn-sm" style="margin-left:4px;" @click="selectedIds = []">清除选择</button>
      </span>
    </div>

    <!-- 表格 -->
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:40px;"><input type="checkbox" @change="toggleAll" :checked="allSelected" /></th>
            <th>代码·名称</th>
            <th class="text-right">最新价</th>
            <th class="text-right">涨跌幅</th>
            <th class="text-center">PE</th>
            <th class="text-center">行业</th>
            <th class="text-center">自选日</th>
            <th class="text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tableRows" :key="row.id" :class="{ 'row-selected': selectedIds.has(row.id) }">
            <td><input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggle(row.id)" /></td>
            <td>
              <div class="stock-name-cell" @click="handleKline(row.ts_code, row.name)">
                <div style="font-weight:600;color:var(--color-accent);cursor:pointer;">{{ row.name }}</div>
                <div style="font-size:11px;color:var(--text-secondary)">{{ row.ts_code }}</div>
              </div>
            </td>
            <td class="text-right" :style="{ color: getChangeColor(row.change || 0) }">{{ row.close?.toFixed(2) || '-' }}</td>
            <td class="text-right">
              <span class="tag" :class="(row.pct_chg ?? 0) > 0 ? 'tag-up' : (row.pct_chg ?? 0) < 0 ? 'tag-down' : 'tag-neutral'">
                {{ formatPercent(row.pct_chg || 0) }}
              </span>
            </td>
            <td class="text-center">{{ row.pe ? row.pe.toFixed(1) : '-' }}</td>
            <td class="text-center"><span class="tag tag-accent">{{ row.industry || '-' }}</span></td>
            <td class="text-center">
              <span v-if="row.selectedDate" class="wl-date-tag" @click="handleKline(row.ts_code, row.name, row.selectedDate)" :title="'点击在K线中标记此日期'">
                {{ row.selectedDate }}
              </span>
              <span v-else style="color:var(--text-secondary);font-size:11px;">--</span>
            </td>
            <td class="text-center">
              <button class="btn btn-ghost btn-sm" @click="handleRemove(row.id, row.ts_code)" title="删除">🗑️</button>
            </td>
          </tr>
          <tr v-if="tableRows.length === 0 && !wlStore.loading">
            <td colspan="8">
              <div class="state-message"><div class="icon">⭐</div><div class="text">暂无自选股，点击上方添加</div></div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ═══ 分析区域（选中后显示） ═══ -->
    <div v-if="showAnalysis && selectedCodes.length >= 2" style="margin-top:24px;">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">📊 组合分析（已选 {{ selectedCodes.length }} 只）</h3>

      <div class="content-grid">
        <CorrelationHeatmap
          :names="selectedNames"
          :matrix="correlationMatrix2D"
          :high-pairs="highCorrelationPairs"
          :loading="analysisLoading"
        />
        <div class="span-2">
          <CapmAnalysis
            key="wl-capm"
            :holdings="selectedHoldings"
            @refresh="runAnalysis"
          />
        </div>
      </div>

      <div style="margin-top:20px;">
        <EfficientFrontier
          key="wl-ef"
          :holdings="selectedHoldings"
        />
      </div>

      <!-- 分散化建议 -->
      <div v-if="concentrationAdvice" class="advice-card" style="margin-top:20px;">
        <h4 style="margin:0 0 8px;">🎯 分散化建议</h4>
        <div class="advice-body">{{ concentrationAdvice }}</div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <div v-if="showAnalysis && selectedCodes.length < 2 && selectedCodes.length > 0" class="state-message" style="margin-top:24px;">
      <div class="text">请至少选择 2 只股票进行分析</div>
    </div>

    <!-- ═══ 弹窗 ═══ -->
    <AddStockModal
      v-if="showAddModal"
      @close="showAddModal = false"
      @submit="handleAdd"
    />
    <KlinePopup
      v-if="klineTsCode"
      :ts-code="klineTsCode"
      :stock-name="klineStockName"
      :mark-date="klineMarkDate"
      @close="klineTsCode = null"
    />
  </div>
</template>

<script setup lang="ts">
import { useWatchlistStore } from '~/stores/watchlist'
import { useUiStore } from '~/stores/ui'
import AddStockModal from '~/components/watchlist/AddStockModal.vue'
import KlinePopup from '~/components/portfolio/KlinePopup.vue'
import CorrelationHeatmap from '~/components/portfolio/CorrelationHeatmap.vue'
import CapmAnalysis from '~/components/portfolio/CapmAnalysis.vue'
import EfficientFrontier from '~/components/portfolio/EfficientFrontier.vue'
import { formatPercent, getChangeColor } from '~/utils/formatters'

const wlStore = useWatchlistStore()
const uiStore = useUiStore()

const showAddModal = ref(false)
const showAnalysis = ref(false)
const selectedIds = ref(new Set<string>())
const analysisLoading = ref(false)
const correlationMatrix = ref<any[]>([])

// K线
const klineTsCode = ref<string | null>(null)
const klineStockName = ref('')
const klineMarkDate = ref('')

function handleKline(tsCode: string, name: string, markDate?: string) {
  klineTsCode.value = tsCode
  klineStockName.value = name
  klineMarkDate.value = markDate || ''
}

// ═══ 表格 ═══
const tableRows = computed(() => {
  const q = wlStore.quotes
  return wlStore.stocks.map(s => {
    const qq = q[s.ts_code]
    return {
      id: s.id, ts_code: s.ts_code, name: s.name,
      close: qq?.close, change: qq?.change, pct_chg: qq?.pct_chg,
      pe: qq?.pe, industry: qq?.industry || '-',
      selectedDate: (s as any).selected_date || '',
    }
  })
})

const allSelected = computed(() => tableRows.value.length > 0 && tableRows.value.every(r => selectedIds.value.has(r.id)))
function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) tableRows.value.forEach(r => selectedIds.value.add(r.id))
  else selectedIds.value = new Set()
}
function toggle(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
  selectedIds.value = new Set(selectedIds.value)
}

// ═══ 选中的分析数据 ═══
const selectedCodes = computed(() => tableRows.value.filter(r => selectedIds.value.has(r.id)).map(r => r.ts_code))
const selectedNames = computed(() => tableRows.value.filter(r => selectedIds.value.has(r.id)).map(r => r.name))
const selectedHoldings = computed(() => tableRows.value.filter(r => selectedIds.value.has(r.id)).map(r => ({
  ts_code: r.ts_code, name: r.name, close: r.close, shares: 100, cost: r.close || 0, marketValue: (r.close || 0) * 100,
})))

const highCorrelationPairs = computed(() => correlationMatrix.value.filter((m: any) => Math.abs(m.correlation) > 0.7))

// ★ 将 API 返回的 [{code1,code2,correlation}] 转为热力图需要的 number[][]
const correlationMatrix2D = computed(() => {
  const n = selectedCodes.value.length
  if (n < 2) return []
  const m: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) m[i][i] = 1
  for (const item of correlationMatrix.value) {
    const ci = selectedCodes.value.indexOf(item.code1)
    const cj = selectedCodes.value.indexOf(item.code2)
    if (ci >= 0 && cj >= 0) {
      m[Math.max(ci, cj)][Math.min(ci, cj)] = item.correlation
    }
  }
  return m
})
const concentrationAdvice = computed(() => {
  if (correlationMatrix.value.length === 0 || selectedNames.value.length < 2) return ''
  const avgCorr = correlationMatrix.value.reduce((s: number, m: any) => s + Math.abs(m.correlation), 0) / correlationMatrix.value.length
  const industrySet = new Set(tableRows.value.filter(r => selectedIds.value.has(r.id)).map(r => r.industry))
  const parts: string[] = []
  if (avgCorr > 0.6) parts.push(`⚠️ 所选股票平均相关性 ${(avgCorr*100).toFixed(0)}%，偏高。建议减少同行业重叠或加入负相关/低相关品种。`)
  else if (avgCorr < 0.35) parts.push(`✅ 所选股票平均相关性 ${(avgCorr*100).toFixed(0)}%，分散化程度良好。`)
  else parts.push(`所选股票平均相关性 ${(avgCorr*100).toFixed(0)}%，处于中等水平。`)
  if (industrySet.size < selectedNames.value.length * 0.4) parts.push(`行业集中度较高（${industrySet.size} 个行业覆盖 ${selectedNames.value.length} 只股票），建议增加跨行业配置。`)
  return parts.join(' ')
})

async function runAnalysis() {
  if (selectedCodes.value.length < 2) return
  showAnalysis.value = true
  analysisLoading.value = true
  try {
    const resp = await fetch(`/api/portfolio/correlation?ts_codes=${selectedCodes.value.join(',')}&names=${encodeURIComponent(selectedNames.value.join(','))}&days=500`)
    const json = await resp.json()
    if (json.success) correlationMatrix.value = json.data.matrix || []
  } catch {} finally { analysisLoading.value = false }
}

// ═══ 添加 / 删除 ═══
async function handleAdd(tsCode: string, name: string, industry: string, selectedDate: string) {
  try { await wlStore.add(tsCode, name, selectedDate); showAddModal.value = false } catch (e: any) { alert(e.message) }
}
async function handleRemove(id: string, tsCode: string) {
  selectedIds.value.delete(id)
  await wlStore.remove(tsCode)
}

// ═══ 初始化 ═══
onMounted(() => {
  uiStore.setActiveNav('watchlist')
  wlStore.init()
})
</script>
