/**
 * GET /api/market/fear-greed — A 股恐惧贪婪指数 (0-100)
 *
 * 衡量短期风险偏好，不混入估值/股债利差：
 *   1. 市场广度 25%      — 全市场上涨比例 + 强上涨比例
 *   2. 赚钱效应 25%      — 涨跌停结构 + 大涨大跌结构
 *   3. 风险偏好 20%      — 主要指数涨跌 + 成长/小盘相对强弱
 *   4. 资金行为 20%      — 全市场成交额历史分位 + 北向 + 融资
 *   5. 拥挤修正 10%      — 前 5% 个股成交额占比
 */
import { promises as fs } from 'fs'
import path from 'path'
import {
  callTushare,
  getIndexDaily,
  getLatestTradeDate,
  getLimitList,
  getMargin,
} from '@/server/adapters/tushare'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-fear-greed.json')
const CACHE_TTL = 5 * 60 * 1000
const INITIAL_HISTORY_DAYS = 60

type Level = 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed'

interface DailyPoint {
  tradeDate: string
  totalAmount: number
  crowdingRatio: number
  index: number
}

interface FundPoint {
  tradeDate: string
  northMoney: number | null
  marginBalance: number | null
  marginChange: number | null
}

function clamp100(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function percentile(values: number[], value: number, minSamples = 8): number | null {
  const valid = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (valid.length < minSamples) return null
  const rank = valid.filter(v => v <= value).length
  return clamp100((rank / valid.length) * 100)
}

function scorePctChange(pct: number): number {
  return clamp100(50 + pct * 20)
}

function levelOf(index: number): { level: Level; label: string } {
  if (index <= 20) return { level: 'extreme_fear', label: '极度恐惧' }
  if (index <= 40) return { level: 'fear', label: '恐惧' }
  if (index <= 60) return { level: 'neutral', label: '中性' }
  if (index <= 80) return { level: 'greed', label: '贪婪' }
  return { level: 'extreme_greed', label: '极度贪婪' }
}

async function readCache(): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8'))
  } catch {
    return null
  }
}

async function fetchMarketDaily(tradeDate: string): Promise<any[]> {
  return callTushare(
    'daily',
    { trade_date: tradeDate },
    'ts_code,trade_date,pct_chg,amount',
    { ttl: 4 * 3600 * 1000 },
  )
}

function prevDate(date: string, offset: number): string {
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)))
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

async function findLatestDailyDate(seedDate: string): Promise<{ tradeDate: string; daily: any[] }> {
  const startDate = prevDate(seedDate, 20)
  const openRows = await callTushare(
    'trade_cal',
    { exchange: 'SSE', start_date: startDate, end_date: seedDate, is_open: '1' },
    'cal_date',
    { ttl: 2 * 3600 * 1000 },
  )
  const candidates = openRows.map((r: any) => String(r.cal_date)).sort().reverse().slice(0, 8)
  if (!candidates.includes(seedDate)) candidates.unshift(seedDate)

  for (const dt of candidates) {
    const daily = await fetchMarketDaily(dt)
    if (daily.length >= 1000) return { tradeDate: dt, daily }
  }
  return { tradeDate: seedDate, daily: [] }
}

async function getOpenDates(endDate: string, count: number): Promise<string[]> {
  const startDate = prevDate(endDate, Math.max(90, count * 2))
  const rows = await callTushare(
    'trade_cal',
    { exchange: 'SSE', start_date: startDate, end_date: endDate, is_open: '1' },
    'cal_date',
    { ttl: 2 * 3600 * 1000 },
  )
  return rows.map((r: any) => String(r.cal_date)).sort().slice(-count)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let index = 0
  async function worker() {
    while (index < items.length) {
      const current = items[index++]
      results.push(await fn(current))
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function summarizeDailyPoint(tradeDate: string, daily: any[], index = 50): DailyPoint | null {
  const amounts = daily.map((r: any) => Number(r.amount) || 0).filter(v => v > 0).sort((a, b) => b - a)
  if (amounts.length < 100) return null

  const totalAmount = amounts.reduce((sum, v) => sum + v, 0) / 100000
  const topN = Math.max(1, Math.round(amounts.length * 0.05))
  const topAmount = amounts.slice(0, topN).reduce((sum, v) => sum + v, 0) / 100000
  const crowdingRatio = (topAmount / Math.max(1, totalAmount)) * 100

  return {
    tradeDate,
    totalAmount: round2(totalAmount),
    crowdingRatio: round2(crowdingRatio),
    index,
  }
}

async function buildInitialDailyHistory(tradeDate: string, current: DailyPoint, existing: DailyPoint[]): Promise<DailyPoint[]> {
  const existingMap = new Map(existing.map(p => [p.tradeDate, p]))
  existingMap.set(current.tradeDate, current)

  if (existingMap.size >= INITIAL_HISTORY_DAYS) {
    return [...existingMap.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).slice(-250)
  }

  const dates = await getOpenDates(tradeDate, INITIAL_HISTORY_DAYS)
  const missingDates = dates.filter(dt => !existingMap.has(dt))
  const points = await mapLimit(missingDates, 4, async dt => {
    const rows = await fetchMarketDaily(dt)
    return summarizeDailyPoint(dt, rows)
  })

  for (const point of points) {
    if (point) existingMap.set(point.tradeDate, point)
  }

  return [...existingMap.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).slice(-250)
}

async function buildInitialFundHistory(tradeDate: string, existing: FundPoint[]): Promise<FundPoint[]> {
  const existingMap = new Map(existing.map(p => [p.tradeDate, p]))
  if (existingMap.size >= INITIAL_HISTORY_DAYS) {
    return [...existingMap.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).slice(-250)
  }

  const dates = await getOpenDates(tradeDate, INITIAL_HISTORY_DAYS)
  const missingDates = dates.filter(dt => !existingMap.has(dt))
  const rawPoints = await mapLimit(missingDates, 4, async dt => {
    const [northRows, marginRows] = await Promise.all([
      callTushare('moneyflow_hsgt', { trade_date: dt }, 'trade_date,north_money,south_money', { ttl: 4 * 3600 * 1000 }).catch(() => []),
      getMargin(dt).catch(() => []),
    ])

    return {
      tradeDate: dt,
      northMoney: northRows.length ? Number(northRows[0].north_money) : null,
      marginBalance: marginRows.length ? Number(marginRows[0].rzye) : null,
      marginChange: null,
    } as FundPoint
  })

  for (const point of rawPoints) existingMap.set(point.tradeDate, point)

  const sorted = [...existingMap.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  let prevBalance: number | null = null
  for (const point of sorted) {
    if (point.marginBalance == null) continue
    point.marginChange = prevBalance == null ? null : point.marginBalance - prevBalance
    prevBalance = point.marginBalance
  }

  return sorted.slice(-250)
}

async function computeRiskAppetite(tradeDate: string) {
  const startDate = (() => {
    const d = new Date(Number(tradeDate.slice(0, 4)), Number(tradeDate.slice(4, 6)) - 1, Number(tradeDate.slice(6, 8)))
    d.setDate(d.getDate() - 14)
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  })()

  const indices = [
    { code: '000300.SH', name: '沪深300', weight: 0.25 },
    { code: '000001.SH', name: '上证指数', weight: 0.20 },
    { code: '000905.SH', name: '中证500', weight: 0.20 },
    { code: '399006.SZ', name: '创业板指', weight: 0.20 },
    { code: '000688.SH', name: '科创50', weight: 0.15 },
  ]

  const detail: Record<string, number> = {}
  let weighted = 0
  let weightSum = 0

  const rowsByIndex = await Promise.all(indices.map(async idx => {
    const rows = await getIndexDaily(idx.code, startDate, tradeDate)
    return { idx, rows }
  }))

  for (const { idx, rows } of rowsByIndex) {
    const sorted = rows.sort((a: any, b: any) => String(a.trade_date).localeCompare(String(b.trade_date)))
    const latest = sorted[sorted.length - 1]
    if (!latest) continue

    const pct = Number(latest.pct_chg) || 0
    detail[idx.code] = round2(pct)
    weighted += scorePctChange(pct) * idx.weight
    weightSum += idx.weight
  }

  const hs300 = detail['000300.SH'] ?? 0
  const growthAvg = ((detail['399006.SZ'] ?? hs300) + (detail['000688.SH'] ?? hs300) + (detail['000905.SH'] ?? hs300)) / 3
  const growthPremium = growthAvg - hs300
  const premiumBoost = Math.max(-10, Math.min(10, growthPremium * 8))
  const score = clamp100((weightSum > 0 ? weighted / weightSum : 50) + premiumBoost)

  return { score, detail, growthPremium: round2(growthPremium) }
}

async function computeFundFlow(tradeDate: string, totalAmount: number, amountHistory: number[], fundHistory: FundPoint[]) {
  const missing: string[] = []
  const amountPct = percentile(amountHistory, totalAmount)

  let northMoney: number | null = null
  let northScore: number | null = null
  try {
    const rows = await callTushare('moneyflow_hsgt', { trade_date: tradeDate }, 'trade_date,north_money,south_money', { ttl: 4 * 3600 * 1000 })
    northMoney = rows.length ? Number(rows[0].north_money) : null
    const vals = fundHistory.map(p => Number(p.northMoney)).filter(Number.isFinite)
    northScore = northMoney != null ? percentile(vals, northMoney) : null
    if (northScore == null && northMoney != null) northScore = northMoney > 0 ? 60 : northMoney < 0 ? 40 : 50
  } catch {
    missing.push('northMoney')
  }

  let marginBalance: number | null = null
  let marginChange: number | null = null
  let marginScore: number | null = null
  try {
    const rows = await getMargin(tradeDate)
    marginBalance = rows.length ? Number(rows[0].rzye) : null
    const prev = [...fundHistory].reverse().find(p => p.tradeDate !== tradeDate && p.marginBalance != null)
    marginChange = marginBalance != null && prev?.marginBalance != null ? marginBalance - prev.marginBalance : null
    const changes = fundHistory.map(p => Number(p.marginChange)).filter(Number.isFinite)
    marginScore = marginChange != null ? percentile(changes, marginChange) : null
    if (marginScore == null && marginChange != null) marginScore = marginChange > 0 ? 60 : marginChange < 0 ? 40 : 50
  } catch {
    missing.push('margin')
  }

  const parts = [
    { key: 'amount', score: amountPct, weight: 0.50 },
    { key: 'northMoney', score: northScore, weight: 0.25 },
    { key: 'margin', score: marginScore, weight: 0.25 },
  ]

  let weighted = 0
  let weightSum = 0
  for (const p of parts) {
    if (p.score == null) {
      if (!missing.includes(p.key)) missing.push(p.key)
      continue
    }
    weighted += p.score * p.weight
    weightSum += p.weight
  }

  return {
    score: weightSum > 0 ? clamp100(weighted / weightSum) : 50,
    amountPercentile: amountPct,
    northPercentile: northScore,
    marginPercentile: marginScore,
    northMoney,
    marginBalance,
    marginChange,
    missing,
  }
}

export default defineEventHandler(async () => {
  try {
    const cached = await readCache()
    if (cached && Date.now() - cached._ts < CACHE_TTL) return cached

    const seedDate = await getLatestTradeDate()
    const { tradeDate, daily } = await findLatestDailyDate(seedDate)
    if (daily.length < 100) throw new Error(`交易日 ${tradeDate} 全市场日线不足`)

    let up = 0, down = 0, flat = 0, up5 = 0, down5 = 0
    const amounts: number[] = []

    for (const row of daily) {
      const pct = Number(row.pct_chg) || 0
      const amount = Number(row.amount) || 0
      if (pct > 0) up++
      else if (pct < 0) down++
      else flat++
      if (pct >= 5) up5++
      if (pct <= -5) down5++
      if (amount > 0) amounts.push(amount)
    }

    const total = daily.length
    const upRatio = (up / total) * 100
    const strongUpRatio = (up5 / total) * 100
    const breadthScore = clamp100(upRatio * 0.7 + strongUpRatio * 2.0)

    const [upLimits, downLimits] = await Promise.all([
      getLimitList(tradeDate, 'U').catch(() => []),
      getLimitList(tradeDate, 'D').catch(() => []),
    ])
    const upLimit = upLimits.length
    const downLimit = downLimits.length
    const limitTotal = upLimit + downLimit
    const bigMoveTotal = up5 + down5
    const limitScore = limitTotal < 10 ? 50 : clamp100((upLimit / limitTotal) * 100)
    const bigMoveScore = bigMoveTotal < 50 ? 50 : clamp100((up5 / bigMoveTotal) * 100)
    const profitScore = clamp100(limitScore * 0.6 + bigMoveScore * 0.4)

    const risk = await computeRiskAppetite(tradeDate)

    amounts.sort((a, b) => b - a)
    // Tushare daily.amount 单位是千元，除以 100000 转为亿元。
    const totalAmount = amounts.reduce((sum, v) => sum + v, 0) / 100000
    const topN = Math.max(1, Math.round(amounts.length * 0.05))
    const topAmount = amounts.slice(0, topN).reduce((sum, v) => sum + v, 0) / 100000
    const crowdingRatio = (topAmount / Math.max(1, totalAmount)) * 100

    const dailyPoint: DailyPoint = {
      tradeDate,
      totalAmount: round2(totalAmount),
      crowdingRatio: round2(crowdingRatio),
      index: 50,
    }
    const existingHistory: DailyPoint[] = Array.isArray(cached?.dailyHistory) ? cached.dailyHistory : []
    const existingFundHistory: FundPoint[] = Array.isArray(cached?.fundHistory) ? cached.fundHistory : []
    const dailyHistory = await buildInitialDailyHistory(tradeDate, dailyPoint, existingHistory)
    const baselineFundHistory = await buildInitialFundHistory(tradeDate, existingFundHistory)

    const amountHistory = dailyHistory.map(p => p.totalAmount)
    const fund = await computeFundFlow(tradeDate, dailyPoint.totalAmount, amountHistory, baselineFundHistory)

    let crowdingScore = 55
    if (crowdingRatio < 20) crowdingScore = 35
    else if (crowdingRatio < 35) crowdingScore = 70
    else if (crowdingRatio < 45) crowdingScore = 55
    else if (crowdingRatio < 55) crowdingScore = 40
    else crowdingScore = 25

    const index = Math.round(
      breadthScore * 0.25 +
      profitScore * 0.25 +
      risk.score * 0.20 +
      fund.score * 0.20 +
      crowdingScore * 0.10,
    )
    const { level, label } = levelOf(index)

    dailyPoint.index = index
    const finalDailyHistory = [
      ...dailyHistory.filter(p => p.tradeDate !== tradeDate),
      dailyPoint,
    ].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).slice(-250)

    let history: Array<{ date: string; index: number }> = Array.isArray(cached?.history) ? cached.history : []
    const last = history[history.length - 1]
    if (!last || last.date !== tradeDate) history.push({ date: tradeDate, index })
    else last.index = index
    history = history.slice(-90)

    const fundPoint: FundPoint = {
      tradeDate,
      northMoney: fund.northMoney ?? null,
      marginBalance: fund.marginBalance ?? null,
      marginChange: fund.marginChange ?? null,
    }
    const fundHistory = [
      ...baselineFundHistory.filter(p => p.tradeDate !== tradeDate),
      fundPoint,
    ].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).slice(-250)

    const explain = [
      `上涨家数占比 ${round2(upRatio)}%，涨超5% ${up5} 家`,
      `涨停 ${upLimit} 家、跌停 ${downLimit} 家，涨超5%/跌超5% 为 ${up5}/${down5}`,
      `成长/小盘相对沪深300强弱 ${risk.growthPremium >= 0 ? '+' : ''}${risk.growthPremium}%`,
      fund.amountPercentile == null
        ? '成交额历史样本不足，资金分按可用项重算'
        : `全市场成交额约 ${round2(totalAmount)} 亿元，位于本地历史第 ${fund.amountPercentile} 分位`,
      `前5%个股成交额占比 ${round2(crowdingRatio)}%，拥挤修正分 ${crowdingScore}`,
    ]

    const result = {
      success: true,
      tradeDate,
      index,
      label,
      level,
      components: {
        breadth: breadthScore,
        profitEffect: profitScore,
        riskAppetite: risk.score,
        fundFlow: fund.score,
        crowding: crowdingScore,
      },
      legacyComponents: {
        limitRatio: limitScore,
        hs300Chg: scorePctChange(risk.detail['000300.SH'] ?? 0),
        volume: fund.amountPercentile ?? 50,
      },
      details: {
        breadth: { score: breadthScore, total, up, down, flat, upRatio: round2(upRatio), strongUpRatio: round2(strongUpRatio) },
        profitEffect: { score: profitScore, upLimit, downLimit, up5, down5, limitScore, bigMoveScore },
        riskAppetite: { score: risk.score, indexPctChg: risk.detail, growthPremium: risk.growthPremium },
        fundFlow: fund,
        crowding: { score: crowdingScore, top5AmountRatio: round2(crowdingRatio), totalAmount: round2(totalAmount), topAmount: round2(topAmount) },
      },
      explain,
      history,
      dailyHistory: finalDailyHistory,
      fundHistory,
      _ts: Date.now(),
    }

    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    console.error('[fear-greed] fatal:', e.message)
    return { success: false, index: 50, label: '错误', level: 'neutral', components: {}, history: [], error: e.message }
  }
})
