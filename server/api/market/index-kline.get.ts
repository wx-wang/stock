/**
 * GET /api/market/index-kline?code=000001.SH&days=60
 * 返回指定指数的最近 N 日 K 线数据（open/high/low/close/vol）
 */
import { getIndexDaily } from '@/server/adapters/tushare'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const code = String(query.code || '000001.SH')
    const days = Math.min(Math.max(Number(query.days) || 60, 20), 365)

    const now = new Date()
    const endDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
    const start = new Date(now); start.setDate(start.getDate() - days - 10)  // 多拉 10 天防周末
    const startDate = `${start.getFullYear()}${String(start.getMonth()+1).padStart(2,'0')}${String(start.getDate()).padStart(2,'0')}`

    const items = await getIndexDaily(code, startDate, endDate)
    if (!items || items.length < 2) return { success: false, kline: [] }

    // 只取最近 days 天
    const sliced = items.slice(-days)
    const data = sliced.map((r: any) => ({
      trade_date: r.trade_date,
      open: Number(r.open) || 0,
      close: Number(r.close) || 0,
      high: Number(r.high) || 0,
      low: Number(r.low) || 0,
      vol: Number(r.vol) || 0,
      amount: Number(r.amount) || 0,
      pct_chg: Number(r.pct_chg) || 0,
    }))

    return { success: true, kline: data }
  } catch (e: any) {
    return { success: false, kline: [], error: e.message }
  }
})
