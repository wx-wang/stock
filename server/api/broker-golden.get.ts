/**
 * GET /api/broker-golden — 券商月度金股（近12个月）
 *   ?month=202606 — 返回该月股票+价格（批量拉取）
 * 缓存: persist/broker-golden.json
 */
import { getDailyBatch } from '@/server/lib/tushare'
import { promises as fs } from 'fs'
import path from 'path'

const PERSIST_DIR = path.resolve('/sessions/6a1d476cb705a1c7ea935295/persist')
const CACHE_FILE = path.join(PERSIST_DIR, 'broker-golden.json')

function fmtDate8(d: Date) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), d2 = String(d.getDate()).padStart(2, '0'); return `${y}${m}${d2}` }

function findMonthStartPrice(items: any[], year: number, month: number): number {
  const prefix = `${year}${String(month).padStart(2, '0')}`
  let earliest: any = null
  for (const item of items) {
    const d = String(item.trade_date)
    if (d.startsWith(prefix) && (!earliest || d < earliest.trade_date)) earliest = item
  }
  return earliest ? (Number(earliest.close) || 0) : 0
}

export default defineEventHandler(async (event) => {
  try {
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    const q = getQuery(event)
    const targetMonth = (q.month as string) || ''

    // ── 读缓存 ──
    let cacheData: any[] = []
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8')
      cacheData = JSON.parse(raw).data || []
    } catch { return { success: false, error: '缓存不存在，请先运行数据预加载脚本' } }

    // ── 模式1：返回全部月份列表（不含价格） ──
    if (!targetMonth) {
      const result = cacheData.map((m: any) => ({
        month: m.month, monthLabel: m.monthLabel,
        stocks: m.stocks.map((s: any) => ({
          name: s.name, ts_code: s.ts_code, count: s.count,
          startPrice: 0, latestPrice: 0, changePct: 0,
        })),
      }))
      return { success: true, data: result }
    }

    // ── 模式2：批量拉取指定月份所有股票价格 ──
    const monthEntry = cacheData.find((m: any) => m.month === targetMonth)
    if (!monthEntry) return { success: false, error: `未找到月份 ${targetMonth}` }

    const yy = parseInt(targetMonth.slice(0, 4)), mm = parseInt(targetMonth.slice(4, 6))
    const sDate = `${yy}${String(mm).padStart(2, '0')}01`
    const eDate = fmtDate8(new Date())

    const tsCodes = monthEntry.stocks.map((s: any) => s.ts_code)
    const batchResult = await getDailyBatch(tsCodes, sDate, eDate)

    const priced = monthEntry.stocks.map((s: any) => {
      const items = batchResult.get(s.ts_code) || []
      const startP = findMonthStartPrice(items, yy, mm)
      const sorted = [...items].sort((a, b) => String(b.trade_date).localeCompare(String(a.trade_date)))
      const latestP = sorted.length > 0 ? (Number(sorted[0].close) || 0) : 0
      const chg = startP > 0 ? Math.round((latestP / startP - 1) * 10000) / 100 : 0
      return {
        ts_code: s.ts_code, name: s.name, count: s.count,
        startPrice: startP, latestPrice: latestP, changePct: chg,
      }
    })

    return { success: true, data: { month: targetMonth, monthLabel: monthEntry.monthLabel, stocks: priced } }
  } catch (e: any) {
    console.error('[broker-golden]', e)
    return { success: false, error: e.message }
  }
})
