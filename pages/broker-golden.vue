<template>
  <div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <h2 style="font-size:18px;font-weight:700;margin:0;">🏦 券商金股</h2>
      <span style="font-size:12px;color:var(--text-secondary);">
        {{ baseMonths.length }} 个月 · {{ totalStocks }} 只股票
      </span>
    </div>

    <div v-if="error" class="state-message" style="margin-bottom:16px;background:rgba(225,82,65,0.08);border:1px solid rgba(225,82,65,0.2);">
      <div class="text">{{ error }}</div>
    </div>

    <!-- 月度面板 -->
    <div v-for="m in displayMonths" :key="m.month" class="broker-month-card">
      <div class="broker-month-header" @click="toggleMonth(m.month)">
        <span class="broker-month-arrow" :class="{ expanded: expanded.has(m.month) }">▶</span>
        <span class="broker-month-title">{{ m.monthLabel || monthLabel(m.month) }}</span>
        <span class="broker-month-count">{{ m.stocks.length }} 只金股</span>
        <span v-if="isPriceLoaded(m)" class="broker-month-loaded">✓ 已加载价格</span>
      </div>

      <div v-if="expanded.has(m.month)" class="broker-month-body">
        <!-- 加载价格按钮 -->
        <div style="margin-bottom:12px;">
          <button
            v-if="!isPriceLoaded(m) && !priceLoading.has(m.month)"
            class="btn btn-accent btn-sm"
            @click="fetchPricesForMonth(m.month)"
          >
            💰 加载价格
          </button>
          <span v-else-if="priceLoading.has(m.month)" class="broker-month-loading">
            ⏳ 正在拉取 {{ m.stocks.length }} 只股票价格...
          </span>
          <span v-else style="font-size:12px;color:var(--color-up);">
            ✓ 价格数据已加载
          </span>
        </div>

        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>股票</th>
                <th class="text-center">推荐次数</th>
                <th class="text-right">月初价</th>
                <th class="text-right">最新价</th>
                <th class="text-right">涨幅</th>
                <th>K线</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in m.stocks" :key="s.ts_code">
                <td>
                  <div class="broker-name-cell">
                    <span class="broker-sname">{{ s.name }}</span>
                    <span class="broker-scode">{{ s.ts_code }}</span>
                  </div>
                </td>
                <td class="text-center">
                  <span class="tag" :class="s.count >= 5 ? 'tag-up' : s.count >= 3 ? 'tag-accent' : ''">
                    {{ s.count }} 家
                  </span>
                </td>
                <td class="text-right">{{ formatPrice(s.startPrice) }}</td>
                <td class="text-right">{{ formatPrice(s.latestPrice) }}</td>
                <td class="text-right">
                  <span v-if="s.startPrice > 0" class="tag" :class="s.changePct > 0 ? 'tag-up' : s.changePct < 0 ? 'tag-down' : 'tag-neutral'">
                    {{ s.changePct > 0 ? '+' : '' }}{{ s.changePct.toFixed(2) }}%
                  </span>
                  <span v-else style="color:var(--text-secondary);font-size:11px;">--</span>
                </td>
                <td>
                  <button class="btn btn-ghost btn-sm" @click="openKline(s.ts_code, s.name)">📈</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- K线 -->
    <KlinePopup
      v-if="klineTsCode"
      :ts-code="klineTsCode"
      :stock-name="klineStockName"
      @close="klineTsCode = null"
    />
  </div>
</template>

<script setup lang="ts">
import KlinePopup from '~/components/portfolio/KlinePopup.vue'
import { useUiStore } from '~/stores/ui'

const uiStore = useUiStore()

interface StockItem { name: string; ts_code: string; count: number; startPrice: number; latestPrice: number; changePct: number }
interface MonthData { month: string; monthLabel?: string; stocks: StockItem[] }

const months = ref<MonthData[]>([])
const baseMonths = ref<MonthData[]>([])
const error = ref<string | null>(null)
const expanded = ref(new Set<string>())

const klineTsCode = ref<string | null>(null)
const klineStockName = ref('')
function openKline(tsCode: string, name: string) { klineTsCode.value = tsCode; klineStockName.value = name }

const totalStocks = computed(() => {
  const set = new Set<string>()
  for (const m of baseMonths.value) for (const s of m.stocks) set.add(s.ts_code)
  return set.size
})

function monthLabel(month: string) { return `${month.slice(0,4)}年${month.slice(4)}月` }
function formatPrice(p: number) { return p > 0 ? p.toFixed(2) : '--' }

// 价格加载状态
const priceLoading = ref(new Set<string>())

function isPriceLoaded(m: MonthData): boolean {
  return m.stocks.length > 0 && m.stocks.every(s => s.startPrice > 0)
}

async function fetchPricesForMonth(month: string) {
  if (priceLoading.value.has(month)) return
  const entry = months.value.find(m => m.month === month)
  if (!entry) return

  if (isPriceLoaded(entry)) return

  priceLoading.value.add(month)
  try {
    const resp = await fetch(`/api/broker-golden?month=${month}`)
    const json = await resp.json()
    if (json.success) {
      const priceMap = new Map<string, any>()
      for (const s of json.data.stocks) priceMap.set(s.ts_code, s)
      for (const s of entry.stocks) {
        const p = priceMap.get(s.ts_code)
        if (p) {
          s.name = p.name || s.name
          s.startPrice = p.startPrice
          s.latestPrice = p.latestPrice
          s.changePct = p.changePct
        }
      }
    }
  } catch {} finally {
    priceLoading.value.delete(month)
  }
}

const displayMonths = computed(() => months.value)

function toggleMonth(month: string) {
  if (expanded.value.has(month)) {
    expanded.value.delete(month)
  } else {
    expanded.value.add(month)
  }
  expanded.value = new Set(expanded.value)
}

async function loadData() {
  error.value = null
  try {
    const resp = await fetch('/api/broker-golden')
    const json = await resp.json()
    if (json.success) {
      baseMonths.value = json.data
      months.value = json.data.map((m: any) => ({ ...m }))
      // 不再自动展开和加载价格
    } else {
      error.value = json.error || '加载失败'
    }
  } catch (e: any) { error.value = e.message }
}

onMounted(() => {
  uiStore.setActiveNav('broker-golden')
  loadData()
})
</script>

<style scoped>
.broker-month-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
  overflow: hidden;
}
.broker-month-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; cursor: pointer;
  transition: background 0.15s;
}
.broker-month-header:hover { background: rgba(255,255,255,0.02); }
.broker-month-arrow {
  font-size: 10px; transition: transform 0.2s; color: var(--text-secondary);
}
.broker-month-arrow.expanded { transform: rotate(90deg); }
.broker-month-title { font-size: 15px; font-weight: 700; }
.broker-month-count { font-size: 12px; color: var(--text-secondary); }
.broker-month-loaded { margin-left: auto; font-size: 11px; color: var(--color-up); }
.broker-month-loading { font-size: 12px; color: var(--text-secondary); }
.broker-month-body { padding: 0 16px 12px; }
.broker-name-cell { display: flex; flex-direction: column; }
.broker-sname { font-weight: 600; font-size: 13px; }
.broker-scode { font-size: 10px; color: var(--text-secondary); font-family: monospace; }
</style>
