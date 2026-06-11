/**
 * GET /api/stocks/kline?ts_code=002240.SZ&days=250
 * 返回日线K线数据 + 均线 + MACD(12,26,9) + KDJ(25,3,3)
 */
import { getDaily } from '@/server/lib/tushare'

function formatDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// SMA 平滑（用于 KDJ 的 K/D 线）
function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { result.push(null); continue }
    if (prev == null) { prev = values[i]; result.push(Math.round(prev * 100) / 100); continue }
    prev = (values[i] + (period - 1) * prev) / period
    result.push(Math.round(prev * 100) / 100)
  }
  return result
}

// EMA
function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { result.push(null); continue }
    if (prev == null) { prev = values[i]; result.push(Math.round(prev * 10000) / 10000); continue }
    prev = values[i] * k + prev * (1 - k)
    result.push(Math.round(prev * 10000) / 10000)
  }
  return result
}

function calcMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j]
    result.push(Math.round(sum / period * 100) / 100)
  }
  return result
}

/** MACD(12,26,9) */
function calcMACD(closes: number[]) {
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const dif: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] == null || ema26[i] == null) dif.push(null)
    else dif.push(Math.round((ema12[i]! - ema26[i]!) * 10000) / 10000)
  }
  const dea = ema(dif.filter((v): v is number => v != null), 9)
  // 补齐 dea 前面的 null（前 25 天 ema12/ema26 还没出来，然后是 8 天的 dif EMA 空窗 = 25+8=33 天）
  const deaFull: (number | null)[] = []
  const firstIdx = dif.findIndex(v => v != null)
  let deaI = 0
  for (let i = 0; i < closes.length; i++) {
    if (i < firstIdx || dif[i] == null) {
      deaFull.push(null)
    } else if (dea[deaI] != null) {
      deaFull.push(dea[deaI]!)
      deaI++
    } else {
      deaFull.push(null)
      deaI++
    }
  }
  const macd: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (dif[i] != null && deaFull[i] != null) macd.push(Math.round(2 * (dif[i]! - deaFull[i]!) * 10000) / 10000)
    else macd.push(null)
  }
  return { dif, dea: deaFull, macd }
}

/** KDJ(25,3,3) */
function calcKDJ(highs: number[], lows: number[], closes: number[], n: number, m1: number, m2: number) {
  const rsv: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { rsv.push(null); continue }
    let hh = -Infinity, ll = Infinity
    for (let j = i - n + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j]
      if (lows[j] < ll) ll = lows[j]
    }
    const range = hh - ll
    rsv.push(range === 0 ? 50 : Math.round((closes[i] - ll) / range * 10000) / 100)
  }
  const K = sma(rsv.filter((v): v is number => v != null), m1)
  const kFull: (number | null)[] = []
  let kI = 0
  for (let i = 0; i < closes.length; i++) {
    kFull.push(i < n - 1 ? null : (K[kI++] ?? null))
  }
  const D = sma(kFull.filter((v): v is number => v != null), m2)
  const dFull: (number | null)[] = []
  let dI = 0
  for (let i = 0; i < closes.length; i++) {
    dFull.push(kFull[i] == null ? null : (D[dI++] ?? null))
  }
  const J: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (kFull[i] != null && dFull[i] != null) J.push(Math.round((3 * kFull[i]! - 2 * dFull[i]!) * 100) / 100)
    else J.push(null)
  }
  return { K: kFull, D: dFull, J }
}

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const tsCode = (q.ts_code as string) || ''
    const days = Math.max(60, parseInt((q.days as string) || '250', 10))

    if (!tsCode) return { success: false, error: '缺少 ts_code 参数' }

    const endDate = formatDate(new Date())
    const start = new Date()
    start.setDate(start.getDate() - days * 2)
    const startDate = formatDate(start)

    const rawData = await getDaily(tsCode, startDate, endDate)
    if (rawData.length === 0) {
      return { success: false, error: '无法获取日线数据' }
    }

    const sorted = rawData.sort((a: any, b: any) => (a.trade_date < b.trade_date ? -1 : 1))

    const dates: string[] = []
    const kdata: number[][] = []
    const closes: number[] = []
    const highs: number[] = []
    const lows: number[] = []
    const volumes: number[] = []

    for (const item of sorted) {
      dates.push(item.trade_date as string)
      const open = Number(item.open) || 0
      const close = Number(item.close) || 0
      const high = Number(item.high) || 0
      const low = Number(item.low) || 0
      kdata.push([open, close, low, high])
      closes.push(close)
      highs.push(high)
      lows.push(low)
      volumes.push(Number(item.vol) || 0)
    }

    if (kdata.length < 20) {
      return { success: false, error: `数据不足: ${kdata.length} 天` }
    }

    const { dif, dea, macd } = calcMACD(closes)
    const { K, D, J } = calcKDJ(highs, lows, closes, 25, 3, 3)

    return {
      success: true,
      data: {
        ts_code: tsCode,
        dates,
        kdata,
        volumes,
        ma5: calcMA(closes, 5),
        ma10: calcMA(closes, 10),
        ma20: calcMA(closes, 20),
        ma60: calcMA(closes, 60),
        ma120: calcMA(closes, 120),
        macd_dif: dif,
        macd_dea: dea,
        macd_bar: macd,
        kdj_k: K,
        kdj_d: D,
        kdj_j: J,
      },
    }
  } catch (e: any) {
    console.error('[stocks/kline]', e)
    return { success: false, error: e.message }
  }
})
