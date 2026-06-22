/**
 * GET /api/sectors/capm
 * 申万二级行业CAPM分析：计算各行业近N日的Alpha、Beta等指标
 *
 * Query: days(默认60), index_code(默认000300.SH), threshold(默认2.0), force(默认false)
 *
 * 首次计算后写入文件缓存（当天有效），后续请求秒出
 * 传 force=true 可强制重新计算
 */
import { getSwDailyBatch, getIndexDaily, getIndexClassify } from '@/server/lib/tushare'
import { promises as fs } from 'fs'
import path from 'path'

import { PERSIST_DIR } from '../../config'

function formatDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function getCachePath(days: number, indexCode: string): string {
  return path.join(PERSIST_DIR, `sectors-capm-d${days}-${indexCode.replace('.', '_')}.json`)
}

async function loadCache(days: number, indexCode: string): Promise<any | null> {
  try {
    const filePath = getCachePath(days, indexCode)
    const raw = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(raw)
    // 缓存仅当天有效
    if (data._date === formatDate(new Date())) return data
    return null
  } catch { return null }
}

async function saveCache(days: number, indexCode: string, data: any): Promise<void> {
  try {
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    const filePath = getCachePath(days, indexCode)
    await fs.writeFile(filePath, JSON.stringify(data), 'utf-8')
  } catch {}
}

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const days = Math.max(30, parseInt((q.days as string) || '60', 10))
    const indexCode = (q.index_code as string) || '000300.SH'
    const threshold = parseFloat((q.threshold as string) || '2.0')
    const force = (q.force as string) === 'true'

    // ─── 0. 缓存检查 ───
    if (!force) {
      const cached = await loadCache(days, indexCode)
      if (cached) return { success: true, data: cached, cached: true }
    }

    // ─── 1. 获取申万二级行业列表 ───
    const allSectors = await getIndexClassify('L2', 'SW2021')
    if (allSectors.length === 0) {
      return { success: false, error: '无法获取申万二级行业列表' }
    }
    const sectors = allSectors.filter((s: any) => s.is_pub !== '0')

    // ─── 2. 计算日期范围 ───
    const endDate = formatDate(new Date())
    const start = new Date()
    start.setDate(start.getDate() - days * 2)
    const startDate = formatDate(start)

    // ─── 3. 拉取基准指数数据 ───
    const indexDaily = await getIndexDaily(indexCode, startDate, endDate)
    if (indexDaily.length === 0) {
      return { success: false, error: '无法获取基准指数数据' }
    }

    const mktMap = new Map<string, number>()
    for (const item of indexDaily) {
      const pct = Number(item.pct_chg)
      if (!isNaN(pct)) mktMap.set(item.trade_date as string, pct / 100)
    }

    // ─── 4. 批量拉取所有行业 ───
    const results: SectorCapmResult[] = []
    const TRADING_DAYS = 252
    const ALPHA_ROLLING_W = 20  // Alpha 平滑窗口（交易日）

    const sectorCodes = sectors.map((s: any) => (s.index_code || s.ts_code) as string)
    const sectorNames = sectors.map((s: any) => (s.industry_name || s.name || '') as string)
    const batchMap = await getSwDailyBatch(sectorCodes, startDate, endDate)

    for (let si = 0; si < sectors.length; si++) {
      const tsCode = sectorCodes[si]
      const name = sectorNames[si] || tsCode
      const sectorDaily = batchMap.get(tsCode) || []

      if (sectorDaily.length < 20) {
        results.push({
          ts_code: tsCode, name,
          beta: 0, alpha: 0, alphaAnnual: 0, rSquared: 0, tValue: 0,
          significant: false, annualVol: 0, sharpe: 0,
          cumulativeReturn: 0, rps: 0, tradingDays: sectorDaily.length,
          error: `数据不足: ${sectorDaily.length}天`,
        })
        continue
      }

      const sectorMap = new Map<string, number>()
      const sortedDaily = sectorDaily.sort((a: any, b: any) => (a.trade_date < b.trade_date ? -1 : 1))
      for (const item of sortedDaily) {
        const pct = Number(item.pct_change)
        if (!isNaN(pct)) sectorMap.set(item.trade_date as string, pct / 100)
      }

      const firstClose = Number(sortedDaily[0]?.close)
      const lastClose = Number(sortedDaily[sortedDaily.length - 1]?.close)
      const cumulativeReturn = firstClose > 0 ? (lastClose - firstClose) / firstClose : 0

      const xs: number[] = [], ys: number[] = []
      const allDates = Array.from(new Set([...mktMap.keys(), ...sectorMap.keys()])).sort()
      for (const date of allDates) {
        const mr = mktMap.get(date), sr = sectorMap.get(date)
        if (mr !== undefined && sr !== undefined) { xs.push(mr); ys.push(sr) }
      }

      const n = xs.length
      if (n < 20) {
        results.push({
          ts_code: tsCode, name,
          beta: 0, alpha: 0, alphaAnnual: 0, rSquared: 0, tValue: 0,
          significant: false, annualVol: 0, sharpe: 0,
          tradingDays: n, error: `有效交易日不足: ${n}天`,
        })
        continue
      }

      const { slope, intercept, rSquared, tValue, residuals } = ols(xs, ys)
      const alphaDaily = intercept, alphaAnnual = alphaDaily * TRADING_DAYS
      const beta = slope
      const sectorVar = variance(ys, mean(ys))
      const annualVol = Math.sqrt(sectorVar) * Math.sqrt(TRADING_DAYS)
      const sectorMeanReturn = mean(ys) * TRADING_DAYS
      const sharpe = annualVol > 0 ? (sectorMeanReturn - 0.02) / annualVol : 0
      const nonsysRisk = Math.sqrt(variance(residuals, mean(residuals))) * Math.sqrt(TRADING_DAYS)

      // ── Alpha 动量（方案 2: 滚动斜率） ──
      let alphaMom = 0, alphaMomT = 0, alphaMomSig = false
      if (n >= 40) {
        // 用全期 β 推算每日 Alpha 贡献: α_daily = sectorRet - β × mktRet
        const dailyAlphas: number[] = []
        for (let i = 0; i < n; i++) dailyAlphas.push(ys[i] - beta * xs[i])

        // 滚动 W 日均值平滑
        const rollingAlphas: number[] = []
        for (let i = ALPHA_ROLLING_W - 1; i < dailyAlphas.length; i++) {
          let sum = 0
          for (let j = i - ALPHA_ROLLING_W + 1; j <= i; j++) sum += dailyAlphas[j]
          rollingAlphas.push(sum / ALPHA_ROLLING_W)
        }

        // OLS: rollingAlpha_t = β_mom × t + intercept（t = 0..M-1）
        if (rollingAlphas.length >= 10) {
          const ts = rollingAlphas.map((_, i) => i)  // t = 0, 1, 2, ...
          const { slope: momSlope, tValue: momT } = ols(ts, rollingAlphas)
          alphaMom = Math.round(momSlope * TRADING_DAYS * 10000) / 10000  // 年化
          alphaMomT = Math.round(momT * 1000) / 1000
          alphaMomSig = Math.abs(momT) >= 2.0  // t≥2 视为显著
        }
      }

      results.push({
        ts_code: tsCode, name,
        beta: Math.round(beta * 10000) / 10000,
        alpha: Math.round(alphaDaily * 1000000) / 1000000,
        alphaAnnual: Math.round(alphaAnnual * 10000) / 10000,
        rSquared: Math.round(rSquared * 10000) / 10000,
        tValue: Math.round(tValue * 1000) / 1000,
        significant: Math.abs(tValue) >= threshold,
        annualVol: Math.round(annualVol * 10000) / 10000,
        sharpe: Math.round(sharpe * 10000) / 10000,
        nonsysRisk: Math.round(nonsysRisk * 10000) / 10000,
        cumulativeReturn: Math.round(cumulativeReturn * 10000) / 10000,
        rps: 0,
        tradingDays: n,
        conclusion: makeConclusion(beta, alphaAnnual, rSquared, tValue, threshold, sharpe),
        alphaMomentum: alphaMom,
        alphaMomentumT: alphaMomT,
        alphaMomentumSig: alphaMomSig,
      })
    }

    // ── 5a. 拥挤度计算（成交额占比分位数 + 5日变化）──
    const dailyTotals = new Map<string, number>()
    for (const [, items] of batchMap) {
      for (const item of items) {
        const td = String(item.trade_date)
        dailyTotals.set(td, (dailyTotals.get(td) || 0) + (Number(item.amount) || 0))
      }
    }
    for (const r of results) {
      const items = batchMap.get(r.ts_code)
      if (!items || items.length < 20) { r.crowdingPct = 0; r.crowdingChange = 0; continue }
      const shares: number[] = []
      for (const item of items) {
        const total = dailyTotals.get(String(item.trade_date)) || 1e9
        shares.push((Number(item.amount) || 0) / total)
      }
      const currentShare = shares[shares.length - 1]
      const lookback = shares.slice(Math.max(0, shares.length - 251), shares.length - 1)
      const below = lookback.filter(s => s < currentShare).length
      const pct = Math.round(below / Math.max(1, lookback.length) * 100)
      const share5dAgo = shares.length > 6 ? shares[shares.length - 6] : shares[0]
      const change = Math.round((currentShare - share5dAgo) / Math.max(1e-9, share5dAgo) * 100)
      r.crowdingPct = Math.min(100, pct)
      r.crowdingChange = Math.min(200, Math.max(-100, change))
    }

    // ─── 5. 计算 RPS ───
    const validForRps = results.filter(r => !r.error && r.tradingDays >= 20)
      .sort((a, b) => b.cumulativeReturn! - a.cumulativeReturn!)
    const rpsTotal = validForRps.length
    validForRps.forEach((r, i) => {
      r.rps = rpsTotal > 1 ? Math.round((1 - i / (rpsTotal - 1)) * 100) : 50
    })

    // ─── 6. 市场基准 ───
    const mktReturns = Array.from(mktMap.values())
    const mktVol = Math.sqrt(variance(mktReturns, mean(mktReturns))) * Math.sqrt(TRADING_DAYS)

    const resultData = {
      indexCode, indexName: '沪深300', days, threshold,
      marketAnnualVol: Math.round(mktVol * 10000) / 10000,
      sectors: results,
      totalCount: sectors.length,
      analyzedCount: results.length,
    }

    // ─── 7. 写入缓存 ───
    await saveCache(days, indexCode, { ...resultData, _date: formatDate(new Date()) })

    return { success: true, data: resultData, cached: false }
  } catch (e: any) {
    console.error('[sectors/capm]', e)
    return { success: false, error: e.message }
  }
})

// ============== 数学工具 ==============
function mean(arr: number[]) { let s = 0; for (const v of arr) s += v; return s / arr.length }
function variance(arr: number[], m: number) { let s = 0; for (const v of arr) s += (v - m) ** 2; return s / (arr.length - 1) }

function ols(x: number[], y: number[]) {
  const n = x.length, mx = mean(x), my = mean(y)
  let ssxx = 0, ssyy = 0, ssxy = 0
  for (let i = 0; i < n; i++) { ssxx += (x[i] - mx) ** 2; ssyy += (y[i] - my) ** 2; ssxy += (x[i] - mx) * (y[i] - my) }
  const slope = ssxx === 0 ? 0 : ssxy / ssxx
  const intercept = my - slope * mx
  const residuals: number[] = []; let ssRes = 0
  for (let i = 0; i < n; i++) { const e = y[i] - intercept - slope * x[i]; residuals.push(e); ssRes += e * e }
  const rSquared = ssyy === 0 ? 0 : 1 - ssRes / ssyy
  const seSlope = n < 3 || ssxx === 0 ? Infinity : Math.sqrt(ssRes / (n - 2) / ssxx)
  const tValue = seSlope === Infinity ? 0 : slope / seSlope
  return { slope, intercept, rSquared, tValue, residuals }
}

function makeConclusion(beta: number, alphaAnnual: number, rSquared: number, tValue: number, threshold: number, sharpe: number): string {
  const parts: string[] = []
  if (Math.abs(tValue) >= threshold) {
    if (alphaAnnual > 0.05) parts.push('✅ α显著为正')
    else if (alphaAnnual < -0.05) parts.push('⚠️ α显著为负')
    else parts.push('α≈0')
  } else parts.push('α不显著')
  if (beta > 1.3) parts.push('🚀 高β进攻型')
  else if (beta > 0.9) parts.push('📈 偏进攻')
  else if (beta > 0.6) parts.push('⚖️ 中性')
  else if (beta > 0) parts.push('🛡️ 防御型')
  else parts.push('📉 反向')
  if (rSquared < 0.2) parts.push('与大盘关联弱')
  else if (rSquared > 0.6) parts.push('与大盘关联强')
  if (sharpe > 1.0) parts.push('💎 高夏普')
  else if (sharpe < -0.5) parts.push('⚠️ 低夏普')
  return parts.join(' · ')
}

interface SectorCapmResult {
  ts_code: string; name: string
  beta: number; alpha: number; alphaAnnual: number
  rSquared: number; tValue: number; significant: boolean
  annualVol?: number; sharpe?: number; nonsysRisk?: number
  cumulativeReturn?: number; rps?: number
  tradingDays: number; conclusion?: string; error?: string
  alphaMomentum?: number     // Alpha 年度化斜率（趋势强度）
  alphaMomentumT?: number    // 斜率 t 值
  alphaMomentumSig?: boolean // t≥2 视为显著
  crowdingPct?: number       // 拥挤度分位数 (0~100)
  crowdingChange?: number    // 5日拥挤度变化 (%)
}
