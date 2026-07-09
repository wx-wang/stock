/**
 * GET /api/market/main-theme — 今日主线（行业 + 概念 Top 3）
 * 多维得分算法：5日动量 + 20日动量 + 持续性 + 广度 + 量能
 * 缓存：30 分钟磁盘
 */
import { getThsDaily, getThsIndex, getThsDailyBatch } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-main-theme.json')
const CACHE_TTL = 30 * 60 * 1000

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
    const d20 = new Date(now); d20.setDate(d20.getDate() - 30)
    const startDate = fmtDate(d20)

    // 拉 N 和 I 的列表 + 近 20 天行情
    const [conceptIdx, industryIdx] = await Promise.all([
      getThsIndex('N'),
      getThsIndex('I'),
    ])

    const nameMap = new Map<string, string>()
    for (const r of conceptIdx) nameMap.set(r.ts_code, r.name)
    for (const r of industryIdx) nameMap.set(r.ts_code, r.name)

    // 用最近 3-4 个交易日批量拉行情（性能优化）
    const recentDates: string[] = []
    const d = new Date(now)
    for (let i = 0; i < 4; i++) { recentDates.push(fmtDate(d)); d.setDate(d.getDate() - 1) }

    // 批量拉 20 天概念行情（只对概念做主线）
    const conceptScores = await computeThemes(conceptIdx, startDate, today, recentDates, nameMap)
    const industryScores = await computeThemes(industryIdx, startDate, today, recentDates, nameMap)

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
    return { success: false, industryTheme: [], conceptTheme: [], error: e.message }
  }
})

async function computeThemes(
  indexList: any[], startDate: string, endDate: string,
  recentDates: string[], nameMap: Map<string, string>
): Promise<ThemeItem[]> {
  const codes = indexList.map((r: any) => r.ts_code)
  const results: ThemeItem[] = []

  // 分批次：每个 sector 拉 20 天行情太慢，改用最近 4 天批量 + 简化
  // 简化：只用批量 + 拉完整 20 天对前 50 热门概念做详细计算
  const topN = codes.length > 100 ? 100 : codes.length

  // Step1: 批量取最近一天行情，按涨幅预筛 Top N
  let latestMap: Map<string, any>
  for (const dt of recentDates) {
    latestMap = await getThsDailyBatch(codes, dt)
    if (latestMap.size > 10) break
  }

  if (!latestMap! || latestMap!.size < 5) return []

  // 取前 50 涨的 + 前 50 跌的（平衡）
  const ranked: Array<{ code: string; pct: number }> = []
  for (const [code, row] of latestMap!) ranked.push({ code, pct: Number(row.pct_change) || 0 })
  ranked.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
  const topCodes = ranked.slice(0, topN).map(r => r.code)

  // Step2: 对 Top N 拉 20 天行情
  for (const code of topCodes) {
    try {
      const items = await getThsDaily(code, startDate, endDate)
      if (items.length < 5) continue

      const sorted = items.sort((a: any, b: any) => String(a.trade_date).localeCompare(String(b.trade_date)))

      // 5 日和 20 日涨幅
      const firstPrice = Number(sorted[0].close) || 1
      const lastPrice = Number(sorted[sorted.length - 1].close) || firstPrice
      const price5d = sorted.length > 5 ? Number(sorted[sorted.length - 6].close) || firstPrice : firstPrice

      const chg5 = ((lastPrice - price5d) / price5d) * 100
      const chg20 = ((lastPrice - firstPrice) / firstPrice) * 100

      // Step3: 对比同业排名（用 batch 数据算百分位）
      const all5d: number[] = []
      const all20d: number[] = []
      for (const r of ranked) {
        const pct = Math.abs(r.pct) // 简化为用当日涨幅代替 5d/20d 排名（批量拉全 20d 太贵）
        all5d.push(pct); all20d.push(pct * 0.8) // 近似
      }
      all5d.sort((a, b) => a - b); all20d.sort((a, b) => a - b)

      const m5 = percentileRank(all5d, Math.abs(chg5))
      const m20 = percentileRank(all20d, Math.abs(chg20))

      // 持续性：算自身近 15 天涨的天数
      let upDays = 0
      const recent = sorted.slice(-15)
      for (let i = 1; i < recent.length; i++) {
        if (Number(recent[i].close) > Number(recent[i-1].close)) upDays++
      }
      const persistence = upDays

      // 广度：简化 — 用当日成交额变化
      const vols = sorted.slice(-20).map((r: any) => Number(r.vol) || 0)
      const avgVol = vols.reduce((a: number, b: number) => a + b, 0) / (vols.length || 1)
      const latestVol = vols[vols.length - 1] || 1
      const volRatio = Math.min(latestVol / (avgVol || 1), 3.0)
      const breadth = Math.min(100, Math.round(volRatio * 40)) // 简化：用量能代理广度

      // 加权
      const score = Math.round(
        m5 * 0.30 + m20 * 0.20 + (persistence / 15 * 100) * 0.25 + breadth * 0.15 + Math.min(volRatio * 50, 100) * 0.10
      )

      const narrative = buildNarrative({ momentum5d: m5, momentum20d: m20, persistence, breadth, volumeRatio: volRatio })

      results.push({
        code, name: nameMap.get(code) || code, score, rank: 0,
        dimensions: { momentum5d: m5, momentum20d: m20, persistence, breadth, volumeRatio: Math.round(volRatio * 100) / 100 },
        narrative,
      })
    } catch {}
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, 3).map((r, i) => ({ ...r, rank: i + 1 }))
}

function percentileRank(sorted: number[], val: number): number {
  if (sorted.length === 0) return 50
  const idx = sorted.filter(v => v <= val).length
  return Math.min(100, Math.round((idx / sorted.length) * 100))
}

function buildNarrative(d: ThemeItem['dimensions']): string {
  const parts: string[] = []
  if (d.persistence >= 5) parts.push(`连续 ${d.persistence} 天上涨`)
  if (d.momentum5d >= 70) parts.push(`5 日动量 ${d.momentum5d} 分`)
  if (d.volumeRatio >= 1.5) parts.push(`量能放大 ${d.volumeRatio.toFixed(1)} 倍`)
  if (parts.length === 0) parts.push(`20 日涨幅表现靠前`)
  return parts.join(', ')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}
