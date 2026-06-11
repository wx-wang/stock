/**
 * Watchlist Store — 自选股追踪
 */
import { defineStore } from 'pinia'

interface WatchStock {
  id: string
  ts_code: string
  name: string
}

export const useWatchlistStore = defineStore('watchlist', () => {
  const stocks = ref<WatchStock[]>([])
  const quotes = ref<Record<string, any>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 分析数据（需要多选后触发）
  const correlationMatrix = ref<any[]>([])
  const analysisLoading = ref(false)

  const getTsCodes = () => stocks.value.map(s => s.ts_code)
  const getSelectedCodes = (selected: string[]) => selected
  const stockCount = computed(() => stocks.value.length)

  // ═══ 加载自选股 + 行情 ═══
  async function init() {
    loading.value = true; error.value = null
    try {
      const resp = await fetch('/api/watchlist')
      const json = await resp.json()
      if (json.success) {
        stocks.value = json.data.stocks
        quotes.value = json.data.quotes
      }
    } catch (e: any) { error.value = e.message } finally { loading.value = false }
  }

  // ═══ 添加 ═══
  async function add(tsCode: string, name: string, selectedDate?: string) {
    const resp = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts_code: tsCode, name, selected_date: selectedDate || '' }),
    })
    const json = await resp.json()
    if (!json.success) throw new Error(json.error)
    await init()
  }

  // ═══ 删除 ═══
  async function remove(tsCode: string) {
    await fetch(`/api/watchlist?ts_code=${tsCode}`, { method: 'DELETE' })
    await init()
  }

  // ═══ 刷新行情 ═══
  async function refreshQuotes() {
    await init()
  }

  // ═══ 分析：相关性矩阵 ═══
  async function fetchCorrelation(codes: string[]) {
    if (codes.length < 2) { correlationMatrix.value = []; return }
    try {
      const resp = await fetch(`/api/portfolio/correlation?ts_codes=${codes.join(',')}&days=500`)
      const json = await resp.json()
      if (json.success) correlationMatrix.value = json.data.matrix || []
    } catch {}
  }

  return {
    stocks, quotes, loading, error,
    correlationMatrix, analysisLoading,
    stockCount, getTsCodes, getSelectedCodes,
    init, add, remove, refreshQuotes, fetchCorrelation,
  }
})
