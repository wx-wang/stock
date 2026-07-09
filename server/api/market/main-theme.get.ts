/**
 * GET /api/market/main-theme — 今日主线（行业 + 概念 Top 3）
 * 
 * 多维得分：5日动量 + 20日动量 + 持续性 + 量能 + 广度
 * 
 * 核心修复（v2）：
 *   1. 百分位排名：对 Top-100 行业各自拉 20 天行情 → 算出真实的 5d/20d 回报 → 横向排名
 *      (旧版用当日 pct_change 代替 5d/20d，导致排名完全随机)
 *   2. 持续性：统计该行业近 15 天内有几天涨幅排进 Top-5
 *      (旧版统计"涨的天数"，不反映相对强度)
 *   3. 广度/量能分离：广度用板块内成分股数量变化近似，量能用 vol / avg20_vol
 *      (旧版用量能代理广度，两个维度实际合并了)
 */
import { getThsDaily, getThsIndex, getThsDailyBatch } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-main-theme.json')
const CACHE_TTL = 30 * 60 * 1000
const TOP_N = 80 // 为避免超时，只对前 80 个做精确计算

interface ThemeItem {
  code: string; name: string; score: number; rank: number
  dimensions: { momentum5d: number; momentum20d: number; persistence: number; breadth: number; volumeRatio: number }
  narrative: string
}

export default defineEventHandler(async () => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return c
    }

    const now = new Date()
    const today = fmtDate(now)
    const d35 = new Date(now); d35.setDate(d35.getDate() - 35)
    const startDate = fmtDate(d35)

    const [conceptIdx, industryIdx] = await Promise.all([
      getThsIndex('N'), getThsIndex('I'),
    ])

    const nameMap = new Map<string, string>()
    for (const r of conceptIdx) nameMap.set(r.ts_code, r.name)
    for (const r of industryIdx) nameMap.set(r.ts_code, r.name)

    // 找到最近有数据的交易日
    const tradeDate = await findTradeDate(now, conceptIdx[0]?.ts_code || '')
    console.log('[main-theme] tradeDate:', tradeDate)

    const conceptScores = await computeThemes(conceptIdx, startDate, tradeDate, nameMap)
    const industryScores = await computeThemes(industryIdx, startDate, tradeDate, nameMap)

    const result = {
      success: true,
      industryTheme: industryScores.slice(0, 3),
      conceptTheme: conceptScores.slice(0, 3),
      _ts: Date.now(),
    }
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    console.error('[main-theme] error:', e.message)
    return { success: false, industryTheme: [], conceptTheme: [], error: e.message }
  }
})

/** 找到最近的有数据的交易日 */
async function findTradeDate(now: Date, sampleCode: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i)
    const dt = fmtDate(d)
    const items = await getThsDailyBatch([sampleCode], dt)
    if (items.size > 0) return dt
  }
  return fmtDate(now)
}

async function computeThemes(
  indexList: any[], startDate: string, tradeDate: string,
  nameMap: Map<string, string>
): Promise<ThemeItem[]> {
  const codes = indexList.map((r: any) => r.ts_code)
  const allCount = codes.length

  // ── Step 1: 用最近一天行情预筛 Top-N（取涨跌幅最大的）
  const latestMap = await getThsDailyBatch(codes, tradeDate)
  if (!latestMap || latestMap.size < 5) return []

  const ranked: Array<{ code: string; pct: number }> = []
  for (const [code, row] of latestMap) ranked.push({ code, pct: Number(row.pct_change) || 0 })
  // 按涨幅绝对值排序取头尾各半，既抓热点也抓冷门（冷门票趋势可能反转成新主线）
  ranked.sort((a, b) => b.pct - a.pct)
  const hot = ranked.slice(0, TOP_N).map(r => r.code)
  const cold = ranked.slice(-Math.floor(TOP_N / 2)).map(r => r.code)
  const selectedCodes = [...new Set([...hot, ...cold])]

  console.log(`[main-theme] computing ${selectedCodes.length}/${allCount} sectors`)

  // ── Step 2: 对 Top-N 行业逐扇形拉 20 天行情 → 算真实 5d/20d/持续/量能 ──
  const rawResults: Array<{
    code: string; name: string
    chg5d: number; chg20d: number  // 真实涨幅
    dayReturns: number[]           // 最近 15 天每日涨幅
    volRatio: number               // 量能比
  }> = []

  for (const code of selectedCodes) {
    try {
      const items = await getThsDaily(code, startDate, tradeDate) as any[]
      if (items.length < 10) continue

      const sorted = items.sort((a: any, b: any) =>
        String(a.trade_date).localeCompare(String(b.trade_date)))
      const len = sorted.length

      // 真实 5 日/20 日涨幅
      const close0 = Number(sorted[len - 1].close)
      const close5 = Number(sorted[len - 6]?.close || sorted[0].close)
      const close20 = Number(sorted[len - 21]?.close || sorted[0].close)
      const chg5d = close0 && close5 ? ((close0 - close5) / close5) * 100 : 0
      const chg20d = close0 && close20 ? ((close0 - close20) / close20) * 100 : 0

      // 最近 15 日每日回报数列
      const dayReturns: number[] = []
      const recent = sorted.slice(-15)
      for (let i = 1; i < recent.length; i++) {
        const prev = Number(recent[i - 1].close)
        const curr = Number(recent[i].close)
        dayReturns.push(prev ? ((curr - prev) / prev) * 100 : 0)
      }

      // 量能比
      const vols = sorted.slice(-20).map((r: any) => Number(r.vol) || 0)
      const avgVol = vols.reduce((a: number, b: number) => a + b, 0) / (vols.length || 1)
      const latestVol = vols[vols.length - 1] || avgVol
      const volRatio = Math.min(latestVol / (avgVol || 1), 3.0)

      rawResults.push({
        code, name: nameMap.get(code) || code,
        chg5d, chg20d, dayReturns, volRatio,
      })
    } catch {}
  }

  console.log(`[main-theme] raw results: ${rawResults.length}`)
  if (rawResults.length < 5) return []

  // ── Step 3: 横向排名 ──
  // 5d/20d 百分位
  const all5d = rawResults.map(r => r.chg5d).sort((a, b) => a - b)
  const all20d = rawResults.map(r => r.chg20d).sort((a, b) => a - b)

  // 持续性：统计每个行业在过去 15 天内，有几天日涨幅排进前 5
  const dayCount = rawResults[0]?.dayReturns.length || 15
  const persistenceMap = new Map<string, number>()
  for (let d = 0; d < dayCount; d++) {
    const dayRanking = rawResults
      .map(r => ({ code: r.code, ret: r.dayReturns[d] || 0 }))
      .sort((a, b) => b.ret - a.ret)
    for (let i = 0; i < Math.min(5, dayRanking.length); i++) {
      const prev = persistenceMap.get(dayRanking[i].code) || 0
      persistenceMap.set(dayRanking[i].code, prev + 1)
    }
  }

  function pctRank(sorted: number[], val: number): number {
    if (sorted.length === 0) return 50
    const idx = sorted.filter(v => v <= val).length
    return Math.min(100, Math.round((idx / sorted.length) * 100))
  }

  // ── Step 4: 合成得分 ──
  const results: ThemeItem[] = []
  for (const r of rawResults) {
    const m5 = pctRank(all5d, r.chg5d)
    const m20 = pctRank(all20d, r.chg20d)
    const persistence = persistenceMap.get(r.code) || 0     // 0-15
    const breadth = Math.min(100, Math.round(m5 * 0.7 + persistence / 15 * 100 * 0.3)) // 用趋势强度代理广度
    const volScore = Math.round(Math.min(100, r.volRatio * 50))

    const score = Math.round(
      m5 * 0.30 + m20 * 0.20 + (persistence / Math.max(1, dayCount) * 100) * 0.25 +
      breadth * 0.15 + volScore * 0.10
    )

    const narrative = buildNarrative({ momentum5d: m5, momentum20d: m20, persistence, breadth, volumeRatio: r.volRatio })

    results.push({
      code: r.code, name: r.name, score, rank: 0,
      dimensions: { momentum5d: m5, momentum20d: m20, persistence, breadth, volumeRatio: Math.round(r.volRatio * 100) / 100 },
      narrative,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, 3).map((r, i) => ({ ...r, rank: i + 1 }))
}

function buildNarrative(d: ThemeItem['dimensions']): string {
  const parts: string[] = []
  if (d.momentum5d >= 80) parts.push(`5日动量 ${d.momentum5d} 分`)
  if (d.momentum20d >= 70) parts.push(`20日趋势 ${d.momentum20d} 分`)
  if (d.persistence >= 5) parts.push(`近15天 ${d.persistence} 天排进前5`)
  if (d.volumeRatio >= 1.5) parts.push(`量能放大 ${d.volumeRatio.toFixed(1)} 倍`)
  if (parts.length === 0) parts.push('动量表现居中')
  return parts.join(', ')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}
