/**
 * GET /api/broker-golden — 券商月度金股（近12个月）
 *   ?month=202606 — 返回该月股票+价格（批量拉取）
 * 缓存: persist/broker-golden.json
 * 缓存不存在时自动从 Tushare broker_recommend 拉取并构建
 */
import { getDailyBatch, getBrokerRecommend } from '@/server/lib/tushare'
import { promises as fs } from 'fs'
import path from 'path'

import { PERSIST_DIR } from '../config'
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

/** 生成最近 N 个月的 YYYYMM 列表 */
function lastNMonths(n: number): string[] {
  const result: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

function monthLabel(m: string): string {
  return `${m.slice(0, 4)}年${m.slice(4, 6)}月`
}

/** 从 Tushare 拉取近12个月券商金股，构建缓存 */
async function buildGoldenCache(): Promise<any[]> {
  const months = lastNMonths(12)
  const result: any[] = []

  for (const month of months) {
    const entry = await fetchOneMonth(month)
    if (entry) result.push(entry)
  }

  return result.sort((a, b) => String(b.month).localeCompare(String(a.month)))
}

/** 拉单个月份的金股数据 */
async function fetchOneMonth(month: string): Promise<any | null> {
  try {
    const rows = await getBrokerRecommend(month)
    if (!rows.length) return null

    const countMap = new Map<string, { name: string; count: number }>()
    for (const r of rows) {
      const code = r.ts_code
      if (!countMap.has(code)) countMap.set(code, { name: r.name, count: 0 })
      countMap.get(code)!.count++
    }

    const stocks = Array.from(countMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([ts_code, v]) => ({
        name: v.name, ts_code, count: v.count,
        startPrice: 0, latestPrice: 0, changePct: 0,
      }))

    console.log(`[broker-golden] ${month}: ${stocks.length} stocks`)
    return { month, monthLabel: monthLabel(month), stocks }
  } catch (e: any) {
    console.error(`[broker-golden] failed to fetch month ${month}:`, e.message)
    return null
  }
}

/** 下一个月的 YYYYMM */
function nextMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4)), m = parseInt(ym.slice(4, 6))
  const d = new Date(y, m, 1)  // JS month: 0-indexed, so m (1-based) → new Date(y, m, 1) = next month
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 自愈式增量更新：从缓存最新月份往后拉新数据 */
async function syncLatestMonths(cacheData: any[]): Promise<any[]> {
  if (!cacheData.length) return cacheData

  // 找缓存中最新月份
  const sorted = [...cacheData].sort((a, b) => String(b.month).localeCompare(String(a.month)))
  let latestMonth = sorted[0].month || lastNMonths(1)[0]

  // 逐月往前追，直到拉不到新数据
  const currentMonth = lastNMonths(1)[0]
  let added = 0

  while (latestMonth < currentMonth) {
    const tryMonth = nextMonth(latestMonth)
    // 不超过当前月份（防止追到未来）
    if (tryMonth > currentMonth) break

    console.log(`[broker-golden] trying new month: ${tryMonth}`)
    const entry = await fetchOneMonth(tryMonth)
    if (!entry) break  // 该月还没数据，停

    sorted.unshift(entry)  // 插到最前面（最新）
    latestMonth = tryMonth
    added++
  }

  if (added > 0) {
    // 保持 12 个月窗口
    const result = sorted.slice(0, 12)
    console.log(`[broker-golden] synced ${added} new months, cache now ${result.length} months`)
    return result
  }

  return sorted.slice(0, 12)
}

export default defineEventHandler(async (event) => {
  try {
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    const q = getQuery(event)
    const targetMonth = (q.month as string) || ''
    const force = q.force === 'true'

    // ── 读缓存（force 时跳过） ──
    let cacheData: any[] = []
    if (!force) {
      try {
        const raw = await fs.readFile(CACHE_FILE, 'utf-8')
        cacheData = JSON.parse(raw).data || []
      } catch { /* cache missing → build below */ }
    }

    // ── 缓存不存在 → 自动拉取构建 ──
    if (!cacheData.length) {
      console.log('[broker-golden] cache missing, building from Tushare...')
      cacheData = await buildGoldenCache()
      await fs.writeFile(CACHE_FILE, JSON.stringify({ data: cacheData, updatedAt: new Date().toISOString() }, null, 2))
      console.log(`[broker-golden] cache built: ${cacheData.length} months`)
    } else {
      // ── 自愈式增量更新：检查是否有新月份 ──
      const synced = await syncLatestMonths(cacheData)
      if (synced !== cacheData) {
        cacheData = synced
        await fs.writeFile(CACHE_FILE, JSON.stringify({ data: cacheData, updatedAt: new Date().toISOString() }, null, 2))
      }
    }

    if (!cacheData.length) return { success: true, data: [], message: '暂无券商金股数据（Tushare无返回）' }

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
