/**
 * GET /api/market/theme-timeline — 近 15 日热门行业排名变化
 * 缓存：30 分钟磁盘
 */
import { getThsIndex, getThsDailyBatch } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-theme-timeline.json')
const CACHE_TTL = 30 * 60 * 1000

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}

export default defineEventHandler(async () => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return c
    }

    const now = new Date()

    // 生成最近 15 个日期
    const dates: string[] = []
    const d = new Date(now)
    for (let i = 0; i < 15; i++) {
      dates.push(fmtDate(d))
      d.setDate(d.getDate() - 1)
    }
    dates.reverse()

    // 拉行业列表
    const industries = await getThsIndex('I')
    const indCodes = industries.map((r: any) => r.ts_code)
    const nameMap = new Map<string, string>()
    for (const r of industries) nameMap.set(r.ts_code, r.name)

    // 拉每个日期的 Top 10 行业
    const dateRankings: Array<{ date: string; top: Array<{ code: string; name: string; pctChg: number; rank: number }> }> = []

    for (const dt of dates) {
      try {
        const dailyMap = await getThsDailyBatch(indCodes, dt)
        if (dailyMap.size < 10) continue

        const ranked = [...dailyMap.entries()]
          .map(([code, row]) => ({ code, name: nameMap.get(code) || code, pctChg: Number(row.pct_change) || 0 }))
          .sort((a, b) => b.pctChg - a.pctChg)
          .slice(0, 10)
          .map((r, i) => ({ ...r, rank: i + 1 }))
        dateRankings.push({ date: dt, top: ranked })
      } catch { continue }
    }

    // 找出热门 Top 10 行业中出现在任何一天的行业
    const freq = new Map<string, { code: string; name: string; ranks: Array<{ date: string; rank: number }> }>()
    for (const dr of dateRankings) {
      for (const item of dr.top) {
        if (!freq.has(item.code)) freq.set(item.code, { code: item.code, name: item.name, ranks: [] })
        freq.get(item.code)!.ranks.push({ date: dr.date, rank: item.rank })
      }
    }

    const hotThemes = [...freq.values()]
      .filter(t => t.ranks.length >= 2)
      .sort((a, b) => b.ranks.length - a.ranks.length)
      .slice(0, 8) // Top 8 热门行业

    const result = {
      success: true,
      dates: dateRankings.map(dr => dr.date),
      themes: hotThemes,
      hotItems: dateRankings.map(dr => ({
        date: dr.date,
        top: dr.top.slice(0, 5), // 每天 Top 5 + 涨跌幅
      })),
      _ts: Date.now(),
    }
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    return { success: false, dates: [], themes: [], error: e.message }
  }
})
