/**
 * services/dcf-valuator.ts — DCF 估值引擎（纯函数，不碰 IO）
 *
 * 公式：内在价值 = Σ(PV₁..₃) + TV
 * TV = EPS₃ / (r · (1+r)³)   (永续零增长)
 * r = 1 / marketPE
 */

export interface DcfInput {
  eps1: number   // 26E EPS
  eps2: number   // 27E EPS
  eps3: number   // 28E EPS
  marketPE: number
}

export interface DcfOutput {
  value: number     // 内在价值
  upside: number    // 上行空间 %（相对收盘价）
  tvRatio: number   // 终值占比
}

/** 计算单只股票的 DCF 估值 */
export function computeDcf(input: DcfInput, close: number): DcfOutput {
  const { eps1, eps2, eps3, marketPE } = input

  if (eps1 <= 0 || eps2 <= 0 || eps3 <= 0 || marketPE <= 0) {
    return { value: 0, upside: 0, tvRatio: 0 }
  }

  const r = 1 / marketPE
  const pv1 = eps1 / (1 + r)
  const pv2 = eps2 / (1 + r) ** 2
  const pv3 = eps3 / (1 + r) ** 3
  const tv = eps3 / (r * (1 + r) ** 3)
  const value = pv1 + pv2 + pv3 + tv

  return {
    value: Math.round(value * 100) / 100,
    upside: close > 0 ? Math.round((value / close - 1) * 10000) / 100 : 0,
    tvRatio: value > 0 ? Math.round(tv / value * 100) / 100 : 0,
  }
}

/** 计算加权 marketPE */
export function computeWeightedPE(stocks: Array<{ peTtm: number; totalMv: number }>): number {
  let totalMv = 0, totalEarnings = 0
  for (const s of stocks) {
    if (s.peTtm > 0 && s.totalMv > 0) {
      totalMv += s.totalMv
      totalEarnings += s.totalMv / s.peTtm
    }
  }
  return totalEarnings > 0 ? Math.round(totalMv / totalEarnings * 100) / 100 : 17.65
}

/** 计算个股 PEG = PE_TTM / 三年增速均值(%) */
export function computePeg(peTtm: number, growths: number[]): number {
  const valid = growths.filter(g => g !== 0)
  if (peTtm <= 0 || valid.length === 0) return 0
  const avgG = valid.reduce((a, b) => a + b) / valid.length
  return avgG > 0 ? Math.round(peTtm / avgG * 100) / 100 : 0
}

/** 计算增速 (epsNew/epsOld - 1) × 100 */
export function computeGrowth(epsOld: number, epsNew: number): number {
  return epsOld > 0 ? Math.round((epsNew / epsOld - 1) * 10000) / 100 : 0
}


/** 反解隐含利润增长倍数
 *  DCF 公式：PE = Σ(1+g)^t/(1+r)^t (t=1..10) + (1+g)^10 / [r·(1+r)^10]
 *  二分法解 g → 返回 (1+g)^10
 *  @param pe 静态 PE
 *  @param r  折现率（0.10 = 10%）
 */
export function computeImpliedGrowth(pe: number, r = 0.10): number {
  if (pe <= 0 || r <= 0) return 0
  // g 的范围：-100% 到 50%
  let lo = -0.999, hi = 0.50
  // 验证上界是否够
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    const pv = peFromGrowth(mid, r)
    if (pv < pe) lo = mid
    else hi = mid
  }
  const g = (lo + hi) / 2
  return g > -0.9 ? Math.round((1 + g) ** 10 * 100) / 100 : 0
}

/** 给定增速 g 和折现率 r，算 DCF 理论 PE */
function peFromGrowth(g: number, r: number): number {
  const onePlusG = 1 + g
  const onePlusR = 1 + r
  let sum = 0
  let gPow = onePlusG
  let rPow = onePlusR
  for (let t = 1; t <= 10; t++) {
    sum += gPow / rPow
    gPow *= onePlusG
    rPow *= onePlusR
  }
  // 终值：第 10 年利润永续零增长
  const terminal = gPow / onePlusG / (r * rPow / onePlusR)
  return sum + terminal
}

/** 加一个公开版：给定 pe + r，返回 g（百分比） */
export function computeImpliedGrowthRate(pe: number, r = 0.10): number {
  if (pe <= 0 || r <= 0) return 0
  let lo = -0.999, hi = 0.50
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    const pv = peFromGrowth(mid, r)
    if (pv < pe) lo = mid
    else hi = mid
  }
  const g = (lo + hi) / 2
  return g > -0.9 ? Math.round(g * 10000) / 100 : 0  // 百分比
}


/** 终局EPS — 线性增长模型
 *  假设: 利润从 0 线性增长到 m，n 年后稳态永续
 *  市场定价: 当前股价 = 终局DCF值 → 反解终局利润 m
 *  @param price 当前股价（每股）
 *  @param r 折现率
 *  @param n 到达终局的年数
 *  @returns 终局EPS（每股年利润）
 */
export function computeTerminalEps(price: number, r = 0.10, n = 10): number {
  if (price <= 0 || r <= 0 || n <= 0) return 0
  const r1 = 1 + r
  // 分母: Σ[(t/n) / (1+r)^t, t=1..n] + 1/(r*(1+r)^n)
  let sum = 0
  let rp = r1
  for (let t = 1; t <= n; t++) {
    sum += (t / n) / rp
    rp *= r1
  }
  const terminal = 1 / (r * Math.pow(r1, n))
  const denominator = sum + terminal
  return denominator > 0 ? Math.round(price / denominator * 100) / 100 : 0
}


/** 泛化版 DCF 理论 PE（年数 n 可变，用于矩阵计算） */
function peFromGrowthN(g: number, r: number, n: number): number {
  const g1 = 1 + g, r1 = 1 + r
  let sum = 0, gp = g1, rp = r1
  for (let t = 1; t <= n; t++) { sum += gp / rp; gp *= g1; rp *= r1 }
  return sum + (gp / g1) / (r * (rp / r1))
}

/** 泛化版天花板（年数 n + 折现率 r 可变）
 *  @returns (1+g)^n，0 表示不可用（亏损或PE为负）
 */
export function computeGrowthCeiling(staticPe: number, r: number, n: number): number {
  if (staticPe <= 0 || r <= 0 || n <= 0) return 0
  let lo = -0.999, hi = 0.50
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (peFromGrowthN(mid, r, n) < staticPe) lo = mid
    else hi = mid
  }
  const g = (lo + hi) / 2
  return g > -0.9 ? Math.round((1 + g) ** n * 100) / 100 : 0
}
