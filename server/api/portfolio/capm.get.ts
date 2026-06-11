/**
 * GET /api/portfolio/capm
 * CAPM 回归分析：对每只持仓股票 OLS 回归 r_i = α + β × r_m + ε
 *
 * Query: ts_codes, index_code(默认000300.SH), days(默认500), threshold(默认2.0)
 */
import { getDaily, getIndexDaily } from '@/server/lib/tushare'

function formatDate(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0'); return `${y}${m}${day}`
}

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const tsCodesRaw = (q.ts_codes as string) || ''
    const indexCode = (q.index_code as string) || '000300.SH'
    const days = Math.max(60, parseInt((q.days as string) || '500', 10))
    const threshold = parseFloat((q.threshold as string) || '2.0')

    const codes = tsCodesRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (codes.length < 1) return { success: false, error: '至少需要1只股票' }

    // ─── 1. 拉数据 ───
    const endDate = formatDate(new Date())
    const start = new Date(); start.setDate(start.getDate() - days)
    const startDate = formatDate(start)

    // 拉指数日线（用 index_daily 而非 daily）
    const indexDaily = await getIndexDaily(indexCode, startDate, endDate)

    // 拉个股日线（串行+间隔）
    const stockDailys: any[][] = []
    for (const code of codes) {
      const d = await getDaily(code, startDate, endDate)
      stockDailys.push(d)
      if (d.length > 0) await new Promise(r => setTimeout(r, 100))
    }

    const names = codes.map((c, i) => {
      const found = stockDailys[i].find((d: any) => d.name) as any
      return found?.name || c
    })

    // ─── 2. 构建收益率表 ───
    // 市场: date → return
    const mktMap = new Map<string, number>()
    for (const item of indexDaily) {
      const pct = Number(item.pct_chg)
      if (!isNaN(pct)) mktMap.set(item.trade_date as string, pct / 100)
    }

    // 个股: date → return
    const stockMaps: Map<string, number>[] = stockDailys.map(list => {
      const m = new Map<string, number>()
      for (const item of list) {
        const pct = Number(item.pct_chg)
        if (!isNaN(pct)) m.set(item.trade_date as string, pct / 100)
      }
      return m
    })

    // ─── 3. 对齐：找所有股票和市场都有的交易日 ───
    const allDates = new Set<string>()
    for (const d of mktMap.keys()) allDates.add(d)
    for (const sm of stockMaps) for (const d of sm.keys()) allDates.add(d)

    const sortedDates = Array.from(allDates).sort()

    // ─── 4. 逐只股票做回归 ───
    const TRADING_DAYS = 252
    const results: any[] = []

    for (let i = 0; i < codes.length; i++) {
      // 收集该股票和市场都存在的交易日数据
      const xs: number[] = []
      const ys: number[] = []
      for (const date of sortedDates) {
        const mr = mktMap.get(date)
        const sr = stockMaps[i].get(date)
        if (mr !== undefined && sr !== undefined) {
          xs.push(mr)
          ys.push(sr)
        }
      }
      const n = xs.length
      if (n < 30) {
        results.push({
          code: codes[i], name: names[i],
          beta: 0, alpha: 0, alphaAnnual: 0, expectedReturn: 0,
          sigmaEpsilon: 0, sigmaEpsilonAnnual: 0,
          rSquared: 0, tValue: 0, significant: false,
          tradingDays: n, error: `有效交易日仅 ${n} 天`,
        })
        continue
      }

      // OLS: ys = intercept + slope * xs
      const { slope, intercept, rSquared, tValue, residuals } = ols(xs, ys)

      const alphaDaily = intercept
      const alphaAnnual = alphaDaily * TRADING_DAYS

      // 非系统风险 = std(residuals) 年化
      const sigmaEpsilon = Math.sqrt(variance(residuals, mean(residuals)))
      const sigmaEpsilonAnnual = sigmaEpsilon * Math.sqrt(TRADING_DAYS)

      // 系统性风险 = beta² * σ_m²
      const sigmaMarket = Math.sqrt(variance(xs, mean(xs))) * Math.sqrt(TRADING_DAYS)
      const systematicRisk = Math.abs(slope) * sigmaMarket

      // 总风险 = sqrt(系统² + 非系统²)
      const totalRisk = Math.sqrt(sigmaEpsilonAnnual ** 2 + systematicRisk ** 2)

      // ★ 预期年化收益率 (CAPM: r ≈ α + β × r_m)
      const mktAnnualReturn = mean(xs) * TRADING_DAYS
      const expectedReturn = alphaAnnual + slope * mktAnnualReturn

      results.push({
        code: codes[i],
        name: names[i],
        beta: Math.round(slope * 10000) / 10000,
        alpha: Math.round(intercept * 1000000) / 1000000,
        alphaAnnual: Math.round(alphaAnnual * 10000) / 10000,
        expectedReturn: Math.round(expectedReturn * 10000) / 10000,
        sigmaEpsilon: Math.round(sigmaEpsilon * 1000000) / 1000000,
        sigmaEpsilonAnnual: Math.round(sigmaEpsilonAnnual * 10000) / 10000,
        systematicRiskAnnual: Math.round(systematicRisk * 10000) / 10000,
        totalRiskAnnual: Math.round(totalRisk * 10000) / 10000,
        rSquared: Math.round(rSquared * 10000) / 10000,
        tValue: Math.round(tValue * 1000) / 1000,
        significant: Math.abs(tValue) >= threshold,
        tradingDays: n,
        conclusion: makeConclusion(slope, alphaAnnual, sigmaEpsilonAnnual, rSquared, tValue, threshold),
      } as StockCapmResult)
    }

    // ─── 5. 组合汇总 ───
    // 此处不传入持仓权重，前端根据实际持仓市值加权
    return {
      success: true,
      data: {
        codes, names,
        indexCode, indexName: '沪深300',
        days, threshold,
        stocks: results,
        // 市场风险参数（供前端算组合系统性风险用）
        marketAnnualVol: Math.round((
          Math.sqrt(variance(Array.from(mktMap.values()), mean(Array.from(mktMap.values())))) *
          Math.sqrt(TRADING_DAYS)
        ) * 10000) / 10000,
        marketAnnualReturn: Math.round(mean(Array.from(mktMap.values())) * TRADING_DAYS * 10000) / 10000,
      },
    }
  } catch (e: any) {
    console.error('[capm]', e)
    return { success: false, error: e.message }
  }
})

// ============== 数学工具 ==============

function mean(arr: number[]) { let s = 0; for (const v of arr) s += v; return s / arr.length }
function variance(arr: number[], m: number) {
  let s = 0; for (const v of arr) s += (v - m) ** 2; return s / (arr.length - 1)
}

interface OLsResult { slope: number; intercept: number; rSquared: number; tValue: number; residuals: number[] }

function ols(x: number[], y: number[]): OLsResult {
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

  // Residuals & R²
  const residuals: number[] = []
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * x[i]
    const e = y[i] - pred
    residuals.push(e)
    ssRes += e * e
  }
  const rSquared = ssyy === 0 ? 0 : 1 - ssRes / ssyy

  // t-value for slope: t = slope / SE(slope)
  const seSlope = n < 3 || ssxx === 0 ? Infinity
    : Math.sqrt(ssRes / (n - 2) / ssxx)
  const tValue = seSlope === Infinity ? 0 : slope / seSlope

  return { slope, intercept, rSquared, tValue, residuals }
}

function makeConclusion(
  beta: number, alphaAnnual: number, sigmaEpsilonAnnual: number,
  rSquared: number, tValue: number, threshold: number
): string {
  const parts: string[] = []
  if (Math.abs(tValue) >= threshold) {
    if (alphaAnnual > 0.05) parts.push('✅ α显著正')
    else if (alphaAnnual < -0.05) parts.push('⚠️ α显著负')
    else parts.push('α≈0(无超额收益)')
  } else {
    parts.push('α不显著(无统计意义)')
  }
  if (beta > 1.5) parts.push('🚀 高Beta进攻')
  else if (beta > 1) parts.push('偏进攻')
  else if (beta > 0.5) parts.push('中性')
  else if (beta > 0) parts.push('🛡️ 防御型')
  else parts.push('反向')
  if (rSquared < 0.2) parts.push('与大盘关联弱')
  if (sigmaEpsilonAnnual > 0.40) parts.push('非系统风险高')
  return parts.join(' · ')
}

interface StockCapmResult {
  code: string; name: string
  beta: number; alpha: number; alphaAnnual: number; expectedReturn: number
  sigmaEpsilon: number; sigmaEpsilonAnnual: number
  systematicRiskAnnual: number; totalRiskAnnual: number
  rSquared: number; tValue: number; significant: boolean
  tradingDays: number; conclusion: string; error?: string
}
