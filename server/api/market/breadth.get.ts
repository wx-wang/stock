/**
 * GET /api/market/breadth — 涨跌家数分布
 * 缓存：4 小时磁盘
 */
import { getDailyAll, getLimitList } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-breadth.json')
const CACHE_TTL = 4 * 3600 * 1000

export default defineEventHandler(async () => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return c
    }

    const now = new Date()
    const endStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`

    // 获取最新交易日
    const allDaily = await getDailyAll(endStr)
    if (allDaily.length < 100) {
      // 今天不是交易日，往回调
      const d = new Date(now); d.setDate(d.getDate() - 1)
      const y2 = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
      const fallback = await getDailyAll(y2)
      if (fallback.length > 100) {
        return buildResult(fallback, y2)
      }
      return buildResult(allDaily, endStr)
    }

    return await buildResult(allDaily, endStr)
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

async function buildResult(dailyItems: any[], tradeDate: string) {
  let up = 0, down = 0, flat = 0
  let upMuch = 0, downMuch = 0  // ±5%
  let upLimit = 0, dnLimit = 0 // ±9.5%

  for (const r of dailyItems) {
    const chg = Number(r.pct_chg) || 0
    if (chg > 0) up++; else if (chg < 0) down++; else flat++
    if (chg >= 5) upMuch++
    if (chg <= -5) downMuch++
    if (chg >= 9.5) upLimit++
    if (chg <= -9.5) dnLimit++
  }

  // 尝试从 limit_list 补充更精确的涨跌停
  try {
    const ups = await getLimitList(tradeDate, 'U')
    const dns = await getLimitList(tradeDate, 'D')
    if (ups.length > 0) upLimit = ups.length
    if (dns.length > 0) dnLimit = dns.length
  } catch {}

  const result = {
    success: true,
    tradeDate,
    total: dailyItems.length,
    up, down, flat,
    upMuch, downMuch,
    upLimit, dnLimit,
    upRatio: dailyItems.length > 0 ? (up / dailyItems.length * 100).toFixed(1) : '0',
    _ts: Date.now(),
  }

  const fsMod = await import('fs').then(m => m.promises)
  await fsMod.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
  await fsMod.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
  return result
}
