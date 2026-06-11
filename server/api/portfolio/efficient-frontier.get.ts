/**
 * GET /api/portfolio/efficient-frontier
 * 计算有效前沿（Markowitz Mean-Variance Efficient Frontier）
 *
 * 算法：Monte Carlo 随机组合 + 帕累托前沿提取 + 数值优化找最大 Sharpe
 *
 * Query: ts_codes, days(默认250), risk_free(默认2.5)
 */
import { getDaily } from '@/server/lib/tushare'

function formatDate(d: Date) { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}${m}${day}` }

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const tsCodesRaw = (q.ts_codes as string) || ''
    const days = Math.max(30, parseInt((q.days as string) || '250', 10))
    const riskFree = parseFloat((q.risk_free as string) || '2.5') / 100

    const codes = tsCodesRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (codes.length < 2) return { success: false, error: '至少需要2只股票' }

    // ─── 1. 拉日线数据（串行加间隔，防止打爆代理） ───
    const endDate = formatDate(new Date())
    const start = new Date(); start.setDate(start.getDate() - days)
    const startDate = formatDate(start)

    const dailyLists: any[][] = []
    for (const code of codes) {
      const data = await getDaily(code, startDate, endDate)
      dailyLists.push(data)
      if (data.length > 0) await new Promise(r => setTimeout(r, 100)) // 100ms 间隔
    }
    const names: string[] = codes.map((c, i) => {
      const d = dailyLists[i].find((d: any) => d.name) as any
      return d?.name || c
    })

    // ─── 2. 构建日收益率矩阵 ───
    const returnMatrix: (number | null)[][] = codes.map(() => [])
    const dateSet = new Set<string>()
    for (let i = 0; i < codes.length; i++) {
      const sorted = [...dailyLists[i]].reverse()
      for (const item of sorted) {
        const dt = item.trade_date as string
        const ret = Number(item.pct_chg)
        if (!isNaN(ret)) {
          returnMatrix[i].push(ret / 100)
          dateSet.add(dt)
        }
      }
    }

    // 对齐：取所有股票都有的最近 N 个收益率
    const minLen = Math.min(...returnMatrix.map(r => r.length))
    if (minLen < 30) return { success: false, error: `有效交易日仅 ${minLen} 天，需 ≥30 天` }

    const aligned: number[][] = codes.map((_, i) => returnMatrix[i].slice(-minLen))

    // ─── 3. 计算年化参数 ───
    const TRADING_DAYS = 252
    const n = codes.length
    const meanReturns = aligned.map(r => mean(r) * TRADING_DAYS)          // 年化预期收益率
    const covMatrix = covariance(aligned, TRADING_DAYS)                    // 年化协方差矩阵

    // ─── 4. Monte Carlo 随机组合 ───
    const SAMPLES = 60000
    const portfolioReturns: number[] = []
    const portfolioVols: number[] = []
    const portfolioWeights: number[][] = []

    for (let s = 0; s < SAMPLES; s++) {
      const w = randomWeights(n)
      const r = dot(w, meanReturns)
      const vol = Math.sqrt(portfolioVar(w, covMatrix))
      portfolioReturns.push(r)
      portfolioVols.push(vol)
      portfolioWeights.push(w)
    }

    // ─── 5. 提取有效前沿（帕累托前沿） ───
    const pareto = extractPareto(portfolioReturns, portfolioVols, portfolioWeights)

    // ─── 6. 找最大 Sharpe 组合（切点） ───
    let bestSharpe = -Infinity, tangencyIdx = 0
    for (let i = 0; i < pareto.returns.length; i++) {
      const sharpe = (pareto.returns[i] - riskFree) / pareto.vols[i]
      if (sharpe > bestSharpe) { bestSharpe = sharpe; tangencyIdx = i }
    }
    const tangency = {
      ret: pareto.returns[tangencyIdx],
      vol: pareto.vols[tangencyIdx],
      sharpe: bestSharpe,
      weights: pareto.weights[tangencyIdx],
    }

    // ─── 7. 当前持仓位置（需要外部传入 holdings 数据） ───
    // 这个 API 不直接访问 holdings，前端计算好当前权重后传入
    // 这里只返回股票级别的参数，前端自己算当前仓位位置

    // ─── 8. CML 数据（从 rf 到切点的直线） ───
    const cmlPoints = [
      { vol: 0, ret: riskFree },
      { vol: tangency.vol * 2, ret: riskFree + bestSharpe * tangency.vol * 2 },
    ]

    return {
      success: true,
      data: {
        codes,
        names,
        meanReturns,       // 年化预期收益 [n]
        covMatrix,         // 年化协方差矩阵 [n][n]
        singleStocks: codes.map((c, i) => ({
          code: c, name: names[i],
          ret: meanReturns[i],
          vol: Math.sqrt(covMatrix[i][i]),
        })),
        frontier: {
          returns: pareto.returns,  // [m] 有效前沿收益
          vols: pareto.vols,        // [m] 有效前沿波动
          weights: pareto.weights,  // [m][n] 有效前沿权重
        },
        tangency,
        cml: cmlPoints,
        riskFree,
        tradingDays: minLen,
      },
    }
  } catch (e: any) {
    console.error('[efficient-frontier]', e)
    return { success: false, error: e.message }
  }
})

// ============== 数学工具 ==============

function mean(arr: number[]) { let s = 0; for (const v of arr) s += v; return s / arr.length }
function dot(a: number[], b: number[]) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

function randomWeights(n: number): number[] {
  // Dirichlet(1,1,...,1) 均匀分布在 simplex 上
  const w: number[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    const e = -Math.log(Math.random())
    w.push(e)
    sum += e
  }
  return w.map(v => v / sum)
}

function portfolioVar(w: number[], cov: number[][]): number {
  let v = 0
  for (let i = 0; i < w.length; i++)
    for (let j = 0; j < w.length; j++)
      v += w[i] * cov[i][j] * w[j]
  return v
}

function covariance(data: number[][], annualize: number): number[][] {
  const n = data.length
  const T = data[0].length
  const means = data.map(r => mean(r))
  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0
      for (let t = 0; t < T; t++) s += (data[i][t] - means[i]) * (data[j][t] - means[j])
      cov[i][j] = cov[j][i] = (s / (T - 1)) * annualize
    }
  }
  return cov
}

function extractPareto(
  returns: number[], vols: number[], weights: number[][]
): { returns: number[]; vols: number[]; weights: number[][] } {
  const n = returns.length
  // 按波动率分组（分 500 个桶），每桶取收益最高的
  const minVol = Math.min(...vols), maxVol = Math.max(...vols)
  const BUCKETS = 500
  const bucketSize = (maxVol - minVol) / BUCKETS || 0.001

  const best: Map<number, { ret: number; vol: number; w: number[] }> = new Map()

  for (let i = 0; i < n; i++) {
    const b = Math.floor((vols[i] - minVol) / bucketSize)
    const idx = Math.max(0, Math.min(BUCKETS - 1, b))
    if (!best.has(idx) || returns[i] > best.get(idx)!.ret) {
      best.set(idx, { ret: returns[i], vol: vols[i], w: weights[i] })
    }
  }

  // 过滤无效前沿（被支配的点）
  const sorted = Array.from(best.entries())
    .map(([_, v]) => v)
    .filter(v => v.vol > 0)
    .sort((a, b) => a.vol - b.vol)

  // 移除被支配的点：在相同或更高波动下没有更高收益的点
  const frontier: typeof sorted = []
  let maxRet = -Infinity
  for (const p of sorted) {
    if (p.ret > maxRet + 0.0001) {
      frontier.push(p)
      maxRet = p.ret
    }
  }

  return {
    returns: frontier.map(p => p.ret),
    vols: frontier.map(p => p.vol),
    weights: frontier.map(p => p.w),
  }
}
