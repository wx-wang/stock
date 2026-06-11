/**
 * GET /api/sectors/capm-trend
 * 单个行业 Alpha/Beta 滚动窗口趋势
 *
 * Query: index_code, window(默认60), days(默认150), base_index(默认000300.SH)
 * 返回: [{date, alpha, alphaAnnual, beta, rSquared}, ...]
 */
import { getSwDaily, getIndexDaily } from '@/server/lib/tushare'

function formatDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const indexCode = (q.index_code as string) || ''
    const windowDays = Math.max(40, parseInt((q.window as string) || '60', 10))
    const totalDays = Math.max(windowDays + 30, parseInt((q.days as string) || '150', 10))
    const baseIndex = (q.base_index as string) || '000300.SH'
    const TRADING_DAYS = 252

    if (!indexCode) return { success: false, error: '缺少 index_code 参数' }

    // ─── 1. 拉数据 ───
    const endDate = formatDate(new Date())
    const start = new Date()
    start.setDate(start.getDate() - totalDays * 2)
    const startDate = formatDate(start)

    // 并行拉取行业和基准
    const [sectorDaily, indexDaily] = await Promise.all([
      getSwDaily(indexCode, startDate, endDate),
      getIndexDaily(baseIndex, startDate, endDate),
    ])

    if (sectorDaily.length < windowDays) {
      return { success: false, error: `行业数据不足，只有 ${sectorDaily.length} 天` }
    }
    if (indexDaily.length < windowDays) {
      return { success: false, error: `基准指数数据不足` }
    }

    // ─── 2. 构建完整时间序列（对齐日期）───
    const sectorMap = new Map<string, number>()
    for (const item of sectorDaily) {
      const pct = Number(item.pct_change)
      if (!isNaN(pct)) sectorMap.set(item.trade_date as string, pct / 100)
    }

    const mktMap = new Map<string, number>()
    for (const item of indexDaily) {
      const pct = Number(item.pct_chg)
      if (!isNaN(pct)) mktMap.set(item.trade_date as string, pct / 100)
    }

    // 取双方都有的日期，按时间排序
    const allDates = Array.from(new Set([...sectorMap.keys(), ...mktMap.keys()])).sort()
    const aligned: { date: string; sectorRet: number; mktRet: number }[] = []
    for (const date of allDates) {
      const sr = sectorMap.get(date)
      const mr = mktMap.get(date)
      if (sr !== undefined && mr !== undefined) {
        aligned.push({ date, sectorRet: sr, mktRet: mr })
      }
    }

    if (aligned.length < windowDays) {
      return { success: false, error: `对齐后数据不足: ${aligned.length} 天` }
    }

    // ─── 3. 滚动窗口 CAPM ───
    // 从第 windowDays 个点开始，每隔 step 个交易日取一个快照
    const step = Math.max(2, Math.floor(aligned.length / 30))
    const trend: TrendPoint[] = []

    for (let i = windowDays - 1; i < aligned.length; i += step) {
      const window = aligned.slice(i - windowDays + 1, i + 1)
      const xs = window.map(w => w.mktRet)
      const ys = window.map(w => w.sectorRet)

      const { slope, intercept, rSquared } = ols(xs, ys)
      const alphaAnnual = intercept * TRADING_DAYS

      trend.push({
        date: window[window.length - 1].date,
        alpha: Math.round(intercept * 1000000) / 1000000,
        alphaAnnual: Math.round(alphaAnnual * 10000) / 10000,
        beta: Math.round(slope * 10000) / 10000,
        rSquared: Math.round(rSquared * 10000) / 10000,
      })
    }

    // 确保最后一个点是最新一天
    if (trend.length > 0 && trend[trend.length - 1].date !== aligned[aligned.length - 1].date) {
      const window = aligned.slice(aligned.length - windowDays)
      const xs = window.map(w => w.mktRet)
      const ys = window.map(w => w.sectorRet)
      const { slope, intercept, rSquared } = ols(xs, ys)
      const alphaAnnual = intercept * TRADING_DAYS
      trend.push({
        date: window[window.length - 1].date,
        alpha: Math.round(intercept * 1000000) / 1000000,
        alphaAnnual: Math.round(alphaAnnual * 10000) / 10000,
        beta: Math.round(slope * 10000) / 10000,
        rSquared: Math.round(rSquared * 10000) / 10000,
      })
    }

    return {
      success: true,
      data: {
        indexCode,
        windowDays,
        baseIndex,
        totalTradingDays: aligned.length,
        points: trend.length,
        trend,
      },
    }
  } catch (e: any) {
    console.error('[sectors/capm-trend]', e)
    return { success: false, error: e.message }
  }
})

// ============== 数学工具 ==============

function mean(arr: number[]) {
  let s = 0; for (const v of arr) s += v; return s / arr.length
}

interface OlsResult {
  slope: number; intercept: number; rSquared: number
}

function ols(x: number[], y: number[]): OlsResult {
  const n = x.length
  const mx = mean(x), my = mean(y)
  let ssxx = 0, ssyy = 0, ssxy = 0
  for (let i = 0; i < n; i++) {
    ssxx += (x[i] - mx) ** 2
    ssyy += (y[i] - my) ** 2
    ssxy += (x[i] - mx) * (y[i] - my)
  }
  const slope = ssxx === 0 ? 0 : ssxy / ssxx
  const intercept = my - slope * mx
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const e = y[i] - intercept - slope * x[i]
    ssRes += e * e
  }
  const rSquared = ssyy === 0 ? 0 : 1 - ssRes / ssyy
  return { slope, intercept, rSquared }
}

interface TrendPoint {
  date: string
  alpha: number
  alphaAnnual: number
  beta: number
  rSquared: number
}
