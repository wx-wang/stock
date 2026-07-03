/**
 * GET /api/trend/indices
 *
 * 返回四大指数的最新趋势摘要（复用 analyze 逻辑但只返回 summary）。
 * 缓存 5 分钟。
 */

import { getDaily } from '@/server/lib/tushare'

// ========== 指数定义 ==========

const INDICES = [
  { code: '000001.SH', name: '上证指数' },
  { code: '399001.SZ', name: '深证成指' },
  { code: '399006.SZ', name: '创业板指' },
  { code: '000688.SH', name: '科创50' },
]

// ========== 工具 ==========

function sma(values: number[], period: number): number {
  const slice = values.slice(-period)
  if (slice.length < period) return NaN
  return slice.reduce((a, b) => a + b, 0) / period
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function getTemperature(score: number, atrRatio: number): string {
  if (score === 4) return atrRatio > 3 ? '沸' : '热'
  if (score === 3) return '温'
  if (score === 2) return '平'
  if (score === 1) return '凉'
  return '寒'
}

// ========== 节气状态机（精简版，只跑最终状态） ==========

function runJieqiMachine(snapshots: Array<{ temp: string; score: number; sp20_60: number; sp5_10: number; sp10_20: number; atrRatio: number }>) {
  let jieqi: string | null = null
  let jieqiDays = 0
  let rightDays = 0
  let brokenMA20 = false

  for (const d of snapshots) {
    const score = d.score
    const temp = d.temp

    rightDays++

    if (jieqi === null) {
      if (score === 4) {
        jieqi = '立夏'
        jieqiDays = 1
        rightDays = 1
        brokenMA20 = false
      }
      continue
    }

    // 检查 MA20 是否被击穿
    if (jieqi === '立夏' && score < 4) brokenMA20 = true

    jieqiDays++

    // 立夏 → 夏至
    if (jieqi === '立夏' && rightDays >= 5 && d.sp20_60 > 0.5 && !brokenMA20) {
      jieqi = '夏至'; jieqiDays = 1
      continue
    }

    // 夏至 → 小暑
    if (jieqi === '夏至' && rightDays >= 10 && d.sp5_10 > d.sp10_20 * 0.5) {
      jieqi = '小暑'; jieqiDays = 1
      continue
    }

    // 小暑 → 大暑
    if (jieqi === '小暑' && rightDays >= 15 && d.atrRatio > 3) {
      jieqi = '大暑'; jieqiDays = 1
      continue
    }

    // 立秋
    if (score < 3 || ['平', '凉', '寒'].includes(temp)) {
      jieqi = '立秋'
      jieqiDays = 1
      // 立秋后下一根K线重置
      continue
    }

    // 立秋后自动重置
    if (jieqi === '立秋') {
      if (score === 4) {
        jieqi = '立夏'; jieqiDays = 1; rightDays = 1; brokenMA20 = false
      } else {
        jieqi = null; jieqiDays = 0; rightDays = 0
      }
    }
  }

  return { jieqi, jieqiDays, rightDays }
}

// ========== 缓存 ==========

interface CacheEntry {
  data: any
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

// ========== 主入口 ==========

export default defineEventHandler(async (_event) => {
  const cacheKey = 'indices'
  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  const endDate = formatDate(new Date())
  const start = new Date()
  start.setDate(start.getDate() - 500)
  const startDate = formatDate(start)

  const results: any[] = []

  for (const idx of INDICES) {
    try {
      const rawData = await getDaily(idx.code, startDate, endDate) as any[]

      if (!rawData || rawData.length < 20) {
        results.push({ code: idx.code, name: idx.name, error: '数据不足' })
        continue
      }

      // 排序
      const sorted = rawData
        .map((item: any) => ({
          trade_date: String(item.trade_date || ''),
          close: Number(item.close) || 0,
          open: Number(item.open) || 0,
          high: Number(item.high) || 0,
          low: Number(item.low) || 0,
        }))
        .filter(d => d.close > 0)
        .sort((a: any, b: any) => a.trade_date.localeCompare(b.trade_date))

      if (sorted.length < 20) {
        results.push({ code: idx.code, name: idx.name, error: '数据不足' })
        continue
      }

      // 计算均线 + ATR
      const closes: number[] = []
      const snapshots: any[] = []
      let atrSum = 0
      let atrCount = 0

      for (let i = 0; i < sorted.length; i++) {
        const bar = sorted[i]
        closes.push(bar.close)

        const ma5 = sma(closes, 5)
        const ma10 = sma(closes, 10)
        const ma20 = sma(closes, 20)
        const ma60 = sma(closes, 60)

        // ATR (14 days)
        let atr: number = NaN
        if (i >= 14) {
          let trSum = 0
          for (let j = i - 13; j <= i; j++) {
            const hi = sorted[j].high
            const lo = sorted[j].low
            const pc = j > 0 ? sorted[j - 1].close : sorted[j].open
            trSum += Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc))
          }
          atr = trSum / 14
          atrSum += atr
          atrCount++
        }

        let score = 0
        if (!isNaN(ma5) && bar.close > ma5) score++
        if (!isNaN(ma5) && !isNaN(ma10) && ma5 > ma10) score++
        if (!isNaN(ma10) && !isNaN(ma20) && ma10 > ma20) score++
        if (!isNaN(ma20) && !isNaN(ma60) && ma20 > ma60) score++

        const atrRatio = atrCount > 0 ? atr / (atrSum / atrCount) : 1
        const temp = getTemperature(score, atrRatio)

        const sp5_10 = !isNaN(ma10) && ma10 > 0 ? ((ma5 / ma10) - 1) * 100 : 0
        const sp10_20 = !isNaN(ma20) && ma20 > 0 ? ((ma10 / ma20) - 1) * 100 : 0
        const sp20_60 = !isNaN(ma60) && ma60 > 0 ? ((ma20 / ma60) - 1) * 100 : 0

        snapshots.push({ temp, score, sp5_10, sp10_20, sp20_60, atrRatio })
      }

      const latest = sorted[sorted.length - 1]
      const lastSnap = snapshots[snapshots.length - 1]
      const { jieqi, jieqiDays, rightDays } = runJieqiMachine(snapshots)

      const m5 = sma(closes, 5)
      const m10 = sma(closes, 10)
      const m20 = sma(closes, 20)
      const m60 = sma(closes, 60)

      const atrAvg = atrCount > 0 ? atrSum / atrCount : NaN
      const atr14 = atrCount > 0 ? (() => {
        let trSum = 0
        const end = sorted.length - 1
        for (let j = end - 13; j <= end; j++) {
          const hi = sorted[j].high
          const lo = sorted[j].low
          const pc = j > 0 ? sorted[j - 1].close : sorted[j].open
          trSum += Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc))
        }
        return trSum / 14
      })() : NaN

      results.push({
        code: idx.code.replace(/\.(SH|SZ)$/, ''),
        fullCode: idx.code,
        name: idx.name,
        close: Math.round(latest.close * 100) / 100,
        ma5: Math.round(m5 * 100) / 100,
        ma10: Math.round(m10 * 100) / 100,
        ma20: Math.round(m20 * 100) / 100,
        ma60: Math.round(m60 * 100) / 100,
        score: lastSnap.score,
        temperature: lastSnap.temp,
        tempLabel: lastSnap.temp,
        jieqi,
        jieqiDays,
        rightDays,
        spread_20_60: Math.round(lastSnap.sp20_60 * 100) / 100,
        atr: Math.round(atr14 * 100) / 100,
        atrAvg: Math.round(atrAvg * 100) / 100,
        atrRatio: Math.round(lastSnap.atrRatio * 100) / 100,
      })
    } catch (e: any) {
      console.error(`[trend/indices] failed for ${idx.code}:`, e.message)
      results.push({ code: idx.code, name: idx.name, error: e.message })
    }
  }

  const result = { success: true, indices: results, updatedAt: new Date().toISOString() }

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL })
  return result
})
