import { defineStore } from 'pinia'
import type { Holding, StockQuote, PortfolioSummary, CorrelationItem, AiDiagnosisResult } from '~/types'

export const usePortfolioStore = defineStore('portfolio', () => {
  const holdings = ref<Holding[]>([])
  const quotes = ref<Record<string, StockQuote>>({})
  const summary = ref<PortfolioSummary | null>(null)
  const correlationMatrix = ref<CorrelationItem[]>([])
  const aiDiagnosis = ref<AiDiagnosisResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ===== Server persistence =====
  async function loadFromServer(): Promise<Holding[]> {
    try {
      const resp = await fetch('/api/holdings/load')
      const json = await resp.json()
      return json.holdings || []
    } catch { return [] }
  }

  async function saveToServer() {
    try {
      await fetch('/api/holdings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings: holdings.value }),
      })
    } catch {}
  }

  // ===== localStorage fallback =====
  const STORAGE_KEY = 'portfolio-holdings'
  function loadLocal(): Holding[] {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : [] } catch { return [] }
  }
  function saveLocal() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings.value)) } catch {} }

  // ===== Init: server first, then local fallback, then merge =====
  async function initFromServer() {
    const serverData = await loadFromServer()
    if (serverData.length > 0) {
      holdings.value = serverData
      saveLocal()
      return
    }
    const localData = loadLocal()
    if (localData.length > 0) {
      holdings.value = localData
      saveToServer()
    }
  }

  // ===== Helpers =====
  function generateId(): string { return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}` }
  function getTsCodes(): string[] { return holdings.value.map(h => h.ts_code).filter(Boolean) }

  async function apiPost<T>(path: string, body: any): Promise<T> {
    const resp = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return resp.json()
  }

  // ===== Actions =====
  function addHolding(h: Omit<Holding, 'id'>): Holding {
    const holding: Holding = { ...h, id: generateId() }
    holdings.value.push(holding)
    saveLocal()
    saveToServer()
    return holding
  }

  function removeHolding(id: string) {
    holdings.value = holdings.value.filter(h => h.id !== id)
    saveLocal()
    saveToServer()
  }

  function updateHolding(id: string, updates: Partial<Holding>) {
    const idx = holdings.value.findIndex(h => h.id === id)
    if (idx !== -1) { holdings.value[idx] = { ...holdings.value[idx], ...updates } }
    saveLocal()
    saveToServer()
  }

  async function fetchQuotes() {
    const codes = getTsCodes()
    if (!codes.length) { quotes.value = {}; summary.value = null; return }
    loading.value = true; error.value = null
    try {
      const data = await apiPost<{ quotes: Record<string, StockQuote>; summary: PortfolioSummary }>(
        '/api/portfolio/holdings',
        { holdings: holdings.value.map(h => ({ ts_code: h.ts_code, name: h.name, cost: h.cost, shares: h.shares, buy_date: h.buy_date })) }
      )
      quotes.value = data.quotes ?? {}
      summary.value = data.summary ?? null
    } catch (e: any) { error.value = e.message || '数据加载失败' } finally { loading.value = false }
  }

  async function fetchCorrelation(days?: number) {
    if (getTsCodes().length < 2) { correlationMatrix.value = []; return }
    loading.value = true; error.value = null
    try {
      const names = holdings.value.filter(h => getTsCodes().includes(h.ts_code)).map(h => h.name)
      const resp = await fetch(`/api/portfolio/correlation?ts_codes=${getTsCodes().join(',')}&names=${encodeURIComponent(names.join(','))}&days=250`)
      const json = await resp.json()
      correlationMatrix.value = json.data?.matrix ?? json ?? []
    } catch (e: any) { error.value = e.message || '相关性计算失败' } finally { loading.value = false }
  }

  async function fetchAiDiagnosis() {
    if (!getTsCodes().length) { aiDiagnosis.value = null; return }
    loading.value = true; error.value = null
    try {
      const data = await apiPost<AiDiagnosisResult>('/api/ai/diagnose', {
        holdings: holdings.value, quotes: quotes.value, summary: summary.value, correlation: correlationMatrix.value,
      })
      aiDiagnosis.value = data ?? null
    } catch (e: any) { error.value = e.message || 'AI 分析失败' } finally { loading.value = false }
  }

  async function refreshAll() {
    await fetchQuotes()
    // ★ 行情数据返回 industry 后，自动填充到 holdings 并持久化
    let enriched = false
    for (const h of holdings.value) {
      const qi = quotes.value[h.ts_code]?.industry
      if (!h.industry && qi) { h.industry = qi; enriched = true }
    }
    if (enriched) { saveLocal(); saveToServer() }
    if (getTsCodes().length > 1) { try { await fetchCorrelation() } catch {} }
  }

  // ===== Getters =====
  const holdingCount = computed(() => holdings.value.length)
  const industryDistribution = computed(() => {
    const map = new Map<string, { value: number; stocks: string[] }>()
    for (const h of holdings.value) {
      const q = quotes.value[h.ts_code]
      const industry = h.industry || q?.industry || '其他'
      const mv = (h.shares || 0) * (q?.close || h.cost)
      if (!map.has(industry)) map.set(industry, { value: 0, stocks: [] })
      const entry = map.get(industry)!
      entry.value += mv
      entry.stocks.push(h.name || h.ts_code || h.id)
    }
    return [...map.entries()].map(([k, v]) => ({ industry: k, ...v })).sort((a, b) => b.value - a.value)
  })

  const topHoldings = computed(() =>
    [...holdings.value].sort((a, b) => (b.shares * b.cost) - (a.shares * a.cost)).slice(0, 5)
  )

  const highCorrelationPairs = computed(() =>
    correlationMatrix.value.filter(item => Math.abs(item.correlation) > 0.7)
  )

  return { holdings, quotes, summary, correlationMatrix, aiDiagnosis, loading, error,
    initFromServer, addHolding, removeHolding, updateHolding, fetchQuotes, fetchCorrelation, fetchAiDiagnosis, refreshAll,
    holdingCount, industryDistribution, topHoldings, highCorrelationPairs }
})
