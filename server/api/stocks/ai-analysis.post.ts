/**
 * POST /api/stocks/ai-analysis → 执行全维度分析（技术面 + 基本面 + 六维度评分）
 * GET  /api/stocks/ai-analysis?ts_code=XXX → 读取缓存（见 ai-analysis.get.ts）
 *
 * 数据源：
 *   Tushare → K线/均线/MACD/KDJ/CAPM（技术面）
 *   Investoday → 一致预期/基本面/研报/产业链/分析师（基本面）
 *   DeepSeek → 大模型生成六维度评分报告
 */
import { getDaily, callTushare } from '@/server/lib/tushare'
import { promises as fs } from 'fs'
import path from 'path'

import { DEEPSEEK_API_KEY, INVESTO_KEY, INVESTO_BASE, PERSIST_DIR } from '../../config'
import { computeGrowthCeiling, computeTerminalEps } from '../../services/dcf-valuator'

const DEEPSEEK_KEY = DEEPSEEK_API_KEY

// ============================================================
//  工具函数
// ============================================================
function formatDate(d: Date) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}${m}${day}` }
function fmtISODate(d: Date) { return d.toISOString().slice(0, 10) }
function ema(values: number[], period: number): (number | null)[] { const r: (number | null)[] = [], k = 2 / (period + 1); let p: number | null = null; for (const v of values) { if (p == null) { p = v; r.push(Math.round(p * 1e4) / 1e4) } else { p = v * k + p * (1 - k); r.push(Math.round(p * 1e4) / 1e4) } } return r }
function sma(values: number[], period: number): (number | null)[] { const r: (number | null)[] = []; let p: number | null = null; for (const v of values) { if (v == null) { r.push(null) } else if (p == null) { p = v; r.push(Math.round(p * 100) / 100) } else { p = (v + (period - 1) * p) / period; r.push(Math.round(p * 100) / 100) } } return r }
function ma(values: number[], period: number): (number | null)[] { const r: (number | null)[] = []; for (let i = 0; i < values.length; i++) { if (i < period - 1) { r.push(null) } else { let s = 0; for (let j = i - period + 1; j <= i; j++)s += values[j]; r.push(Math.round(s / period * 100) / 100) } } return r }
function ols(x: number[], y: number[]) { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let ssxx = 0, ssyy = 0, ssxy = 0; for (let i = 0; i < n; i++) { ssxx += (x[i] - mx) ** 2; ssyy += (y[i] - my) ** 2; ssxy += (x[i] - mx) * (y[i] - my) } const slope = ssxx === 0 ? 0 : ssxy / ssxx, intercept = my - slope * mx; const residuals: number[] = []; let ssRes = 0; for (let i = 0; i < n; i++) { const e = y[i] - intercept - slope * x[i]; residuals.push(e); ssRes += e * e } return { slope, intercept, rSquared: ssyy === 0 ? 0 : 1 - ssRes / ssyy, residuals } }

// ============================================================
//  技术面数据描述（同之前）
// ============================================================
function describeVolume(volumes: number[], closes: number[]): string {
  if (volumes.length < 25) return '数据不足'
  const l5 = volumes.slice(-5), p5 = volumes.slice(-10, -5), ar = l5.reduce((a, b) => a + b, 0) / 5, ap = p5.reduce((a, b) => a + b, 0) / 5
  const ch = ap > 0 ? ((ar - ap) / ap * 100).toFixed(0) : 'N/A'
  const l3u = closes.slice(-3).every((c, i) => i === 0 || c >= closes[closes.length - 4 + i])
  const l3d = closes.slice(-3).every((c, i) => i === 0 || c <= closes[closes.length - 4 + i])
  let desc = `最近5日均量${ar > ap ? '放大' : '萎缩'}${ch !== 'N/A' ? Math.abs(Number(ch)) + '%' : ''}`
  if (l3u && ar > ap) desc += '，温和放量上涨'; else if (l3d && ar > ap) desc += '，放量下跌'; else if (l3u && ar < ap) desc += '，缩量上涨'; else if (l3d && ar < ap) desc += '，缩量下跌'
  return desc
}
function describeMA(closes: number[], ma5: (number | null)[], ma20: (number | null)[], ma60: (number | null)[]): string {
  const p = closes[closes.length - 1]
  const f = (n: string, vv: (number | null)[]) => { const v = vv[vv.length - 1]; if (v == null) return '数据不足'; const r = p > v ? '之上' : '之下'; return `现价在${n}日均线${r}(${((p - v) / v * 100).toFixed(1)}%)` }
  const parts = [f('5', ma5), f('20', ma20), f('60', ma60)]
  // 20日线：同时看短期(5日)和中期(21日)斜率
  const s20_5d = ma20[ma20.length - 1] != null && ma20[ma20.length - 6] != null ? ma20[ma20.length - 1]! - ma20[ma20.length - 6]! : null
  const s20_21d = ma20[ma20.length - 1] != null && ma20[ma20.length - 22] != null ? ma20[ma20.length - 1]! - ma20[ma20.length - 22]! : null
  if (s20_5d != null) {
    const d5 = s20_5d > 0.5 ? '加速上升' : s20_5d > 0 ? '缓升' : s20_5d > -0.5 ? '走平' : s20_5d > -2 ? '回落' : '加速下行'
    parts.push(`20日线近5日${d5}(${s20_5d > 0 ? '+' : ''}${s20_5d.toFixed(1)})`)
  }
  if (s20_21d != null && s20_5d != null && Math.sign(s20_5d) !== Math.sign(s20_21d)) {
    parts.push(`(惯性)21日前至今+${s20_21d.toFixed(1)}但近期方向已扭转`)
  }
  if (p < (ma20[ma20.length - 1] || p) && s20_5d != null && s20_5d < 0) {
    parts.push('现价跌破20日线且均线转空，中期趋势恶化')
  }
  return parts.join('；')
}
function describeMACD(dif: (number | null)[], dea: (number | null)[], bar: (number | null)[]): string {
  const ld = dif[dif.length - 1], le = dea[dea.length - 1], lb = bar[bar.length - 1]; if (ld == null) return '数据不足'
  const pd = dif[dif.length - 2], pe = dea[dea.length - 2]
  const cross = pd != null && pe != null ? (pd <= pe && ld > le ? '金叉' : pd >= pe && ld < le ? '死叉' : null) : null
  const parts: string[] = []; parts.push(`DIF=${ld.toFixed(4)}，DEA=${le?.toFixed(4) || 'N/A'}`)
  parts.push(ld > 0 && (le ?? 0) > 0 ? 'DIF/DEA均在0轴上方' : ld < 0 && (le ?? 0) < 0 ? '均在0轴下方' : '穿过0轴')
  if (cross) parts.push(cross); parts.push(lb != null && lb > 0 ? `红柱(${(lb * 2).toFixed(4)})` : `绿柱(${lb != null ? (lb * 2).toFixed(4) : 'N/A'})`)
  return parts.join('，')
}
function describeKDJ(K: (number | null)[], D: (number | null)[], J: (number | null)[]): string {
  const lk = K[K.length - 1], ld = D[D.length - 1], lj = J[J.length - 1]; if (lk == null) return '数据不足'
  const parts = [`K=${lk.toFixed(1)}，D=${ld?.toFixed(1) || 'N/A'}，J=${lj?.toFixed(1) || 'N/A'}`]
  if (lk > 80) parts.push('超买区(K>80)'); else if (lk < 20) parts.push('超卖区(K<20)'); else parts.push('中性区')
  const pk = K[K.length - 2], pd2 = D[D.length - 2]
  if (pk != null && pd2 != null) { if (pk <= pd2 && lk > ld) parts.push('K线上穿D线(金叉)'); else if (pk >= pd2 && lk < ld) parts.push('K线下穿D线(死叉)') }
  return parts.join('，')
}

// ============================================================
//  CAPM（Tushare）
// ============================================================
async function fetchCapm(tsCode: string) {
  try {
    const ed = formatDate(new Date()), sd = formatDate(new Date(Date.now() - 250 * 864e4))
    const url = 'http://lianghua.nanyangqiankun.top', tk = '65a038811c294bcdbc49e4ca1d86e144686ea7d4e84bdc114b94406d44f9'
    const [[sr, ir]] = await Promise.all([Promise.all([
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_name: 'daily', token: tk, params: { ts_code: tsCode, start_date: sd, end_date: ed }, fields: 'trade_date,pct_chg' }) }),
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_name: 'index_daily', token: tk, params: { ts_code: '000300.SH', start_date: sd, end_date: ed }, fields: 'trade_date,pct_chg' }) }),
    ])])
    const [sd2, id2] = await Promise.all([sr.json(), ir.json()])
    const sm = new Map<string, number>(), mm = new Map<string, number>()
    for (const i of sd2?.data?.items || []) { const v = Number(i[1]); if (!isNaN(v)) sm.set(i[0], v / 100) }
    for (const i of id2?.data?.items || []) { const v = Number(i[1]); if (!isNaN(v)) mm.set(i[0], v / 100) }
    const xs: number[] = [], ys: number[] = []
    for (const d of new Set([...sm.keys(), ...mm.keys()])) { const sr = sm.get(d), mr = mm.get(d); if (sr != null && mr != null) { xs.push(mr); ys.push(sr) } }
    if (xs.length < 60) return null
    const { slope, intercept, residuals } = ols(xs, ys)
    const td = 252, alpha = intercept * td, beta = slope
    const mktStd = Math.sqrt(xs.reduce((s, v) => { const d = v - xs.reduce((a, b) => a + b, 0) / xs.length; return s + d * d }, 0) / (xs.length - 1)) * Math.sqrt(td)
    const sysRisk = Math.abs(beta) * mktStd
    const nonsysStd = Math.sqrt(residuals.reduce((s, v) => { const d = v - residuals.reduce((a, b) => a + b, 0) / residuals.length; return s + d * d }, 0) / (residuals.length - 1)) * Math.sqrt(td)
    return { alpha: Math.round(alpha * 1e4) / 1e4, beta: Math.round(beta * 1e4) / 1e4, rSquared: Math.round(ols(xs, ys).rSquared * 1e4) / 1e4, sysRisk: Math.round(sysRisk * 1e4) / 1e4, nonsysRisk: Math.round(nonsysStd * 1e4) / 1e4 }
  } catch { return null }
}

// ============================================================
//  Tushare 利润表（最新季报扭亏验证）
// ============================================================
async function fetchIncomeData(tsCode: string): Promise<any[]> {
  try {
    const items = await callTushare('income', { ts_code: tsCode, start_date: '20250101', end_date: '20260701' },
      'end_date,report_type,total_revenue,n_income,yoy_net_profit')
    return items.sort((a: any, b: any) => String(a.end_date).localeCompare(String(b.end_date)))
  } catch { return [] }
}

function formatQuarterlyIncome(items: any[]): string {
  if (!items || items.length === 0) return '季报数据未获取'
  const lines: string[] = []
  lines.push('★★ 最近季度利润表（Tushare原始数据，注意单位）:')
  for (const it of items) {
    const ed = String(it.end_date || '')
    const rt = String(it.report_type || '')
    const rev = Number(it.total_revenue) || 0
    const ni = Number(it.n_income) || 0
    const yoy = Number(it.yoy_net_profit) || 0
    const label = rt === '20260331' ? '2026Q1' : rt === '20251231' ? '2025年报' : rt === '20250930' ? '2025Q3' : rt === '20250630' ? '2025H1' : rt === '20250331' ? '2025Q1' : rt === '20241231' ? '2024年报' : ed
    lines.push(`  ${label}: 营收${(rev / 1e8).toFixed(2)}亿, 净利${(ni / 1e8).toFixed(2)}亿${ni < 0 ? '(亏损)' : ''}, 净利润同比${yoy.toFixed(1)}%`)
  }
  if (items.length >= 2) {
    const last = items[items.length - 1]
    const prev = items[items.length - 2]
    const lastNi = Number(last.n_income) || 0
    const prevNi = Number(prev.n_income) || 0
    if (prevNi !== 0) {
      const qoq = ((lastNi - prevNi) / Math.abs(prevNi) * 100).toFixed(1)
      lines.push(`  → 最新季度净利环比: ${qoq}%`)
    }
  }
  return lines.join('\n')
}

// ============================================================
//  Investoday API 调用
// ============================================================
async function investoGet(path: string): Promise<any> {
  const resp = await fetch(`${INVESTO_BASE}/${path}`, { headers: { apiKey: INVESTO_KEY }, signal: AbortSignal.timeout(15000) })
  const json = await resp.json()
  if (json.code !== 0) throw new Error(json.message || 'Investoday error')
  return json.data
}
async function investoPost(path: string, body: Record<string, any>): Promise<any> {
  const resp = await fetch(`${INVESTO_BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apiKey: INVESTO_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  const json = await resp.json()
  if (json.code !== 0) throw new Error(json.message || 'Investoday error')
  return json.data
}

/** 并行拉取所有 Investoday 基本面数据 */
async function fetchFundamentals(tsCode: string) {
  const [stockCode, market] = tsCode.includes('.') ? [tsCode.split('.')[0], tsCode.split('.')[1]] : [tsCode, '']
  const results: Record<string, any> = {}

  // 6 个核心 API，并行执行
  const today = fmtISODate(new Date())
  const recentDate = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return fmtISODate(d) })()
  const [consensus, analystMom, forecastRatings, fundamentals, businessThemes, instResearch] = await Promise.allSettled([
    investoPost('consensus/stk-metric', { stockCodes: [stockCode], beginDate: recentDate, endDate: today }),
    investoPost('consensus/stk-anlst-mom', { stockCodes: [stockCode], reportScope: 1, beginDate: recentDate, endDate: today }),
    investoGet(`report/stock-forecast-ratings?stockCode=${stockCode}&pageSize=20`),
    investoGet(`stock/fundamentals?stockCode=${stockCode}`),
    investoPost('stock/business-investment-themes', { stockCodes: [stockCode], pageSize: 3 }),
    investoPost('stock/institutional-research', { stockCodes: [stockCode], beginDate: '2025-06-01', endDate: fmtISODate(new Date()), pageSize: 50 }),
  ])

  if (consensus.status === 'fulfilled') results.consensus = consensus.value?.[0] || consensus.value
  if (analystMom.status === 'fulfilled') results.analystMom = analystMom.value?.[0] || analystMom.value
  if (forecastRatings.status === 'fulfilled') results.forecastRatings = Array.isArray(forecastRatings.value) ? forecastRatings.value : (forecastRatings.value?.records || [])
  if (fundamentals.status === 'fulfilled') results.fundamentals = fundamentals.value
  if (businessThemes.status === 'fulfilled') results.businessThemes = businessThemes.value?.[0] || businessThemes.value
  if (instResearch.status === 'fulfilled') results.instResearch = Array.isArray(instResearch.value) ? instResearch.value : (instResearch.value?.records || [])

  return results
}

// ============================================================
//  基本面数据 → 中文描述（喂给大模型）
// ============================================================
function formatConsensus(d: any): string {
  if (!d) return '一致预期数据未获取'
  const rYear = d.reportYear || 'N/A'  // 例如 2025 = 最新已发布年报的财务年度
  const lines: string[] = []
  lines.push(`最新已发布年报的财务年度: ${rYear}年 (发布于${d.reportPublishDate?.slice(0,10) || 'N/A'})`)
  lines.push(`${rYear}年营收: ${d.revenue != null ? (d.revenue / 1e8).toFixed(2) + '亿' : 'N/A'}, ${rYear}年净利: ${d.netProfit != null ? (d.netProfit / 1e8).toFixed(2) + '亿' : 'N/A'}${d.netProfit != null && d.netProfit < 0 ? '(亏损)' : ''}`)
  lines.push(`${rYear}年EPS: ${d.eps != null ? d.eps.toFixed(3) : 'N/A'}, ROE: ${d.roe != null ? (d.roe * 100).toFixed(1) + '%' : 'N/A'}`)
  lines.push(`★★ 一致预期（当前为2026年，以下为分析师对未来财年的预测）:`)
  lines.push(`  ${rYear + 1}年预期EPS: ${d.consensusEpsFy1?.toFixed(3) || 'N/A'}, 净利增速: ${d.consensusNetProfitYoyFy1?.toFixed(1) || 'N/A'}%, 营收增速: ${d.consensusRevenueYoyFy1?.toFixed(1) || 'N/A'}%`)
  lines.push(`  ${rYear + 2}年预期EPS: ${d.consensusEpsFy2?.toFixed(3) || 'N/A'}, 净利增速: ${d.consensusNetProfitYoyFy2?.toFixed(1) || 'N/A'}%, 营收增速: ${d.consensusRevenueYoyFy2?.toFixed(1) || 'N/A'}%`)
  lines.push(`  ${rYear + 3}年预期EPS: ${d.consensusEpsFy3?.toFixed(3) || 'N/A'}, 净利增速: ${d.consensusNetProfitYoyFy3?.toFixed(1) || 'N/A'}%`)
  lines.push(`前瞻PE: ${rYear + 1}年=${d.consensusPeFy1?.toFixed(1) || 'N/A'}, ${rYear + 2}年=${d.consensusPeFy2?.toFixed(1) || 'N/A'}, PEG(3年)=${d.consensusPeg3y?.toFixed(2) || 'N/A'}`)
  lines.push(`前瞻PB: ${d.consensusPbFy1?.toFixed(2) || 'N/A'}, PS: ${d.consensusPsFy1?.toFixed(2) || 'N/A'}`)
  lines.push(`一致目标价: ${d.consensusTargetPrice?.toFixed(2) || 'N/A'} 元 (空间${d.consensusTargetPriceReturnPct != null ? (d.consensusTargetPriceReturnPct * 100).toFixed(1) + '%' : 'N/A'}), 评级分: ${d.consensusRatingScore?.toFixed(1) || 'N/A'}`)
  lines.push(`最近股价: ${d.lastPrice?.toFixed(2) || 'N/A'}, 总股本: ${d.totalShares != null ? (d.totalShares / 1e8).toFixed(2) + '亿' : 'N/A'}`)
  return lines.join('\n')
}

function formatAnalystMom(d: any): string {
  if (!d) return '分析师动能数据未获取'
  const lines: string[] = []
  lines.push(`净利润预期变动: 1周${d.netProfitChgPct1w?.toFixed(1) || 'N/A'}%(${d.netProfitChgPct1wRank || '-'}名), 1月${d.netProfitChgPct1m?.toFixed(1) || 'N/A'}%(${d.netProfitChgPct1mRank || '-'}名), 3月${d.netProfitChgPct3m?.toFixed(1) || 'N/A'}%(${d.netProfitChgPct3mRank || '-'}名)`)
  lines.push(`营收预期变动: 1月${d.opRevenueChgPct1m?.toFixed(1) || 'N/A'}%, 3月${d.opRevenueChgPct3m?.toFixed(1) || 'N/A'}%`)
  lines.push(`评级动能: 1月${d.ratingMomentum1m?.toFixed(2) || 'N/A'}(得分${d.ratingMomentum1mScore?.toFixed(1) || 'N/A'}), 目标价空间${d.targetPriceUpside?.toFixed(1) || 'N/A'}%(得分${d.targetPriceUpsideScore?.toFixed(1) || 'N/A'})`)
  lines.push(`分析师动能得分: 含营收${d.analystMomentumIncRev?.toFixed(1) || 'N/A'}, 不含营收${d.analystMomentumExcRev?.toFixed(1) || 'N/A'}`)
  return lines.join('\n')
}

function formatForecastRatings(arr: any[]): string {
  if (!arr || arr.length === 0) return '研报预测评级数据未获取'
  // 统计机构数、最新评级分布
  const institutions = new Set<string>()
  const ratings: Record<string, number> = {}
  for (const r of arr) {
    if (r.institutionName) institutions.add(r.institutionName)
    const rating = r.ratingCurrent || r.ratingDescription || '未知'
    ratings[rating] = (ratings[rating] || 0) + 1
  }
  const latest = arr.slice(0, 5)
  const lines: string[] = []
  lines.push(`覆盖机构: ${institutions.size} 家, 近12月研报: ${arr.length} 篇`)
  lines.push(`评级分布: ${Object.entries(ratings).map(([k, v]) => `${k}×${v}`).join(', ')}`)
  lines.push(`最近5篇: ${latest.map(r => `${r.institutionName || ''}(${r.ratingCurrent || r.ratingDescription || ''})目标${r.targetPrice?.toFixed(2) || r.targetPriceEx?.toFixed(2) || 'N/A'} EPS-T1=${r.epsForecastT1?.toFixed(3) || 'N/A'}`).join(' | ')}`)
  return lines.join('\n')
}

function formatFundamental(d: any): string {
  if (!d) return '基本面分析数据未获取'
  const lines: string[] = []
  if (d.competitiveAdvantage) lines.push(`竞争优势: ${String(d.competitiveAdvantage).slice(0, 300)}`)
  if (d.growthDrivers) lines.push(`增长驱动: ${String(d.growthDrivers).slice(0, 300)}`)
  if (d.marketPosition) lines.push(`市场地位: ${String(d.marketPosition).slice(0, 200)}`)
  if (d.executionCapability) lines.push(`执行力: ${String(d.executionCapability).slice(0, 200)}`)
  if (d.financialHealth) lines.push(`财务健康: ${String(d.financialHealth).slice(0, 300)}`)
  if (d.fundConclusion) lines.push(`综合结论: ${String(d.fundConclusion).slice(0, 300)}`)
  return lines.join('\n')
}

function formatBusinessThemes(d: any): string {
  if (!d) return '主营业务与投资主题数据未获取'
  const lines: string[] = []
  if (d.businessStatus) lines.push(`业务地位: ${d.businessStatus}`)
  if (d.operatingData) lines.push(`经营数据: ${d.operatingData.slice(0, 200)}`)
  if (d.investmentTheme) lines.push(`投资主题: ${d.investmentTheme.slice(0, 200)}`)
  if (d.industryChainCapacity) lines.push(`产业链位置: ${d.industryChainCapacity.slice(0, 150)}`)
  if (d.mainBusinessConclusion) lines.push(`主营业务结论: ${d.mainBusinessConclusion.slice(0, 250)}`)
  return lines.join('\n')
}

function formatInstResearch(arr: any[]): string {
  if (!arr || arr.length === 0) return '机构调研数据未获取'
  const sorted = [...arr].sort((a, b) => (b.publishDate || '').localeCompare(a.publishDate || ''))
  const lines: string[] = []
  lines.push(`近12月调研次数: ${arr.length} 次`)
  // 按机构类型分组
  const types: Record<string, number> = {}
  for (const r of arr) { const t = r.researchInstitutionType || '其他'; types[t] = (types[t] || 0) + 1 }
  lines.push(`调研机构类型分布: ${Object.entries(types).map(([k, v]) => `${k}×${v}`).join(', ')}`)
  // 最近3次
  const recent = sorted.slice(0, 3)
  lines.push(`最近调研: ${recent.map(r => `${r.publishDate || ''} ${r.researchInstitutionName || ''}`).join(' | ')}`)
  return lines.join('\n')
}

// ============================================================
//  摘要提取
// ============================================================
function extractSummary(text: string): string {
  const lines = text.split('\n')
  // 优先找"核心投资逻辑"或"执行动作"行
  for (const line of lines) {
    if (line.includes('核心投资逻辑') || line.includes('执行动作') || line.includes('**执行动作**')) {
      const next = lines[lines.indexOf(line) + 1]
      if (next && next.length > 4) return next.replace(/[*#\->]/g, '').trim().slice(0, 60)
    }
  }
  const keywords = ['加仓', '减仓', '持股', '止损', '突破', '观望', '建议', '买入', '卖出', '持有']
  for (const kw of keywords) {
    for (const line of lines) {
      if (line.includes(kw) && line.length < 80) { const c = line.replace(/[*#\-]/g, '').trim(); if (c.length > 4) return c.slice(0, 60) }
    }
  }
  for (const line of lines) { const t = line.trim(); if (!t || t.startsWith('#') || t.startsWith('-') || t.startsWith('*')) continue; return t.slice(0, 60) }
  return 'AI分析完成'
}

// ============================================================
//  缓存
// ============================================================
const aiCache = new Map<string, any>()
async function loadCache(tsCode: string) {
  if (aiCache.has(tsCode)) return aiCache.get(tsCode)!
  try { await fs.mkdir(PERSIST_DIR, { recursive: true }); const raw = await fs.readFile(path.join(PERSIST_DIR, `ai-${tsCode.replace('.', '_')}.json`), 'utf-8'); const data = JSON.parse(raw); aiCache.set(tsCode, data); return data } catch { return null }
}
async function saveCache(tsCode: string, data: any) {
  try { await fs.mkdir(PERSIST_DIR, { recursive: true }); await fs.writeFile(path.join(PERSIST_DIR, `ai-${tsCode.replace('.', '_')}.json`), JSON.stringify(data), 'utf-8'); aiCache.set(tsCode, data) } catch {}
}

// ============================================================
//  主入口
// ============================================================
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const tsCode = (body.ts_code as string) || ''
    const name = (body.name as string) || tsCode
    const shares = Number(body.shares) || 0
    const cost = Number(body.cost) || 0
    const force = body.force === true || body.force === 'true'

    if (!tsCode) return { success: false, error: '缺少 ts_code' }

    // 查缓存
    if (!force) { const cached = await loadCache(tsCode); if (cached) return { success: true, data: { analysis: cached.analysis, summary: cached.summary, date: cached.date, cached: true } } }

    // ═══ 1. 技术面（Tushare） ═══
    const endDate = formatDate(new Date())
    const start = new Date(); start.setDate(start.getDate() - 300)
    const raw = await getDaily(tsCode, formatDate(start), endDate)
    if (raw.length < 60) return { success: false, error: 'K线数据不足' }

    const sorted = raw.sort((a: any, b: any) => (a.trade_date < b.trade_date ? -1 : 1))
    const closes: number[] = [], highs: number[] = [], lows: number[] = [], volumes: number[] = []
    for (const item of sorted) { closes.push(Number(item.close) || 0); highs.push(Number(item.high) || 0); lows.push(Number(item.low) || 0); volumes.push(Number(item.vol) || 0) }
    const curPrice = closes[closes.length - 1]
    const ma5 = ma(closes, 5), ma20 = ma(closes, 20), ma60 = ma(closes, 60)

    // MACD
    const e12 = ema(closes, 12), e26 = ema(closes, 26)
    const dif: (number | null)[] = [], deaArr: (number | null)[] = [], macdBar: (number | null)[] = []
    for (let i = 0; i < closes.length; i++) dif.push(e12[i] != null && e26[i] != null ? Math.round((e12[i]! - e26[i]!) * 1e4) / 1e4 : null)
    const firstD = dif.findIndex(v => v != null); const deaVals = ema(dif.filter((v): v is number => v != null), 9)
    let di = 0; for (let i = 0; i < closes.length; i++) { if (i < firstD || dif[i] == null) { deaArr.push(null) } else { const dv = deaVals[di++]; deaArr.push(dv ?? null) } }
    for (let i = 0; i < closes.length; i++) macdBar.push(dif[i] != null && deaArr[i] != null ? Math.round(2 * (dif[i]! - deaArr[i]!) * 1e4) / 1e4 : null)

    // KDJ(25,3,3)
    const rsv: (number | null)[] = []
    for (let i = 0; i < closes.length; i++) { if (i < 24) { rsv.push(null); continue } let hh = -Infinity, ll = Infinity; for (let j = i - 24; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j] } rsv.push(hh === ll ? 50 : Math.round((closes[i] - ll) / (hh - ll) * 1e4) / 100) }
    const kRaw = sma(rsv.filter((v): v is number => v != null), 3), kVal: (number | null)[] = []; let ki = 0; for (let i = 0; i < closes.length; i++) kVal.push(i < 24 ? null : (kRaw[ki++] ?? null))
    const dRaw = sma(kVal.filter((v): v is number => v != null), 3), dVal: (number | null)[] = []; let di2 = 0; for (let i = 0; i < closes.length; i++) dVal.push(kVal[i] == null ? null : (dRaw[di2++] ?? null))
    const jVal: (number | null)[] = []; for (let i = 0; i < closes.length; i++) jVal.push(kVal[i] != null && dVal[i] != null ? Math.round((3 * kVal[i]! - 2 * dVal[i]!) * 100) / 100 : null)

    const capm = await fetchCapm(tsCode)

    // ═══ 2. 基本面（Investoday + Tushare季报） ═══
    const fd = await fetchFundamentals(tsCode)
    const incomeData = await fetchIncomeData(tsCode)

    // ═══ 3. 构造基本面数据块 ═══
    let fBlock = ''
    fBlock += `【一致预期综合指标】\n${formatConsensus(fd.consensus)}\n\n`
    fBlock += `【分析师动能】\n${formatAnalystMom(fd.analystMom)}\n\n`
    fBlock += `【研报预测评级】\n${formatForecastRatings(fd.forecastRatings)}\n\n`
    fBlock += `【AI基本面分析】\n${formatFundamental(fd.fundamentals)}\n\n`
    fBlock += `【主营业务与投资主题】\n${formatBusinessThemes(fd.businessThemes)}\n\n`
    fBlock += `【机构调研】\n${formatInstResearch(fd.instResearch)}`
    fBlock += `\n\n【最新季报业绩（Tushare原始数据，判断是否已扭亏）】\n${formatQuarterlyIncome(incomeData)}`

    // ── 估值矩阵（天花板 + 终局EPS）──
    const valRates = [0.06, 0.08, 0.10, 0.12]
    const valYears = [5, 10, 15]
    let ceilingBlock = ''
    let terminalBlock = ''

    const sf = path.join(PERSIST_DIR, 'screener-overview.json')
    const rawCode = tsCode.replace(/\.(SZ|SH)$/, '')
    let sPe = 0
    try {
      const sc = JSON.parse(await fs.readFile(sf, 'utf-8'))
      for (const g of sc.groups || []) {
        const found = (g.stocks || []).find((s: any) => s.code === rawCode)
        if (found) { sPe = found.staticPe || 0; break }
      }
    } catch {}

    if (sPe > 0) {
      const lastEps = curPrice / sPe
      const defaultCeil = computeGrowthCeiling(sPe, 0.10, 10)
      const defaultG = defaultCeil > 0 ? Math.pow(defaultCeil, 0.1) - 1 : 0
      const defaultEstPe = defaultCeil > 0 ? sPe / (1 + defaultG) : 0

      let matrix = '            ' + valRates.map(r => ('r=' + (r*100).toFixed(0) + '%').padStart(8)).join('') + '\n'
      for (const n of valYears) {
        let row = ('n=' + String(n).padStart(2) + '年     ')
        for (const r of valRates) {
          const ceil = computeGrowthCeiling(sPe, r, n)
          row += (ceil > 0 ? (ceil.toFixed(2) + 'x') : '  N/A   ').padStart(8)
        }
        matrix += row + '\n'
      }
      ceilingBlock = '[估值模型A: 指数增长天花板]\n'
        + '【重要：以下数值是市场通过当前股价+静态PE反推出的隐含增长预期，不是股价预测】\n'
        + '即：如果市场定价是对的，利润必须按隐含增速增长n年。\n'
        + '你的任务是判断这个"市场隐含要求"是否过高(高估)还是合理/偏低(低估)。\n'
        + '折现率(r)参考：基准10%。出海业务可下调至8%；周期股/高杠杆上调至12%+。\n'
        + '静态PE=' + sPe.toFixed(1) + ' (总市值/去年净利润)\n'
        + '天花板矩阵 (折现率r x 到达年限n):\n' + matrix
        + '> (r=10%, n=10基准): 市场要求利润10年达到' + defaultCeil.toFixed(2) + '倍, '
        + '隐含年化增速' + (defaultG*100).toFixed(1) + '%, '
        + '天花板EPS=' + (defaultCeil*lastEps).toFixed(2) + ', '
        + '预估PE(1年后)=' + defaultEstPe.toFixed(1)
    } else {
      ceilingBlock = '[估值模型A: 指数增长天花板]\n'
        + '⚠️ 无静态PE数据(亏损股或缓存未建立),该模型不适用'
    }

    // 终局EPS矩阵
    {
      const defaultTerm = computeTerminalEps(curPrice, 0.10, 10)
      let matrix = '            ' + valRates.map(r => ('r=' + (r*100).toFixed(0) + '%').padStart(8)).join('') + '\n'
      for (const n of valYears) {
        let row = ('n=' + String(n).padStart(2) + '年     ')
        for (const r of valRates) {
          const te = computeTerminalEps(curPrice, r, n)
          row += (te > 0 ? te.toFixed(2) : '  N/A   ').padStart(8)
        }
        matrix += row + '\n'
      }
      terminalBlock = '[估值模型B: 线性增长终局EPS (元/股)]\n'
        + '【重要：以下数值是市场通过当前股价反推出的隐含终局每股年利润，不是预测】\n'
        + '即：市场给这个定价，等于在说这家公司终局时每年每股应赚这么多钱。\n'
        + '你的任务是判断这个隐含终局利润，对比公司真实能力是偏高(高估)还是偏低(低估)。\n'
        + '折现率参考同上。该模型对亏损股同样适用。\n'
        + '终局EPS矩阵 (折现率r x 到达年限n):\n' + matrix
        + '> (r=10%, n=10基准): 市场隐含终局EPS=' + defaultTerm.toFixed(2) + '元/股'
        + ', 终局PE=' + (defaultTerm > 0 ? (curPrice/defaultTerm).toFixed(1) : 'N/A')
    }

    const valBlock = ceilingBlock + '\n\n' + terminalBlock

    // ═══ 4. 构造 Prompt ═══
    const mktVal = shares * curPrice
    const profitPct = cost > 0 ? ((curPrice - cost) / cost * 100).toFixed(2) : 'N/A'
    const profitAmt = cost > 0 ? ((curPrice - cost) * shares).toFixed(2) : 'N/A'
    const alpha = capm ? (capm.alpha * 100).toFixed(2) + '%' : 'N/A'
    const beta = capm ? capm.beta.toFixed(3) : 'N/A'
    const sysR = capm ? (capm.sysRisk * 100).toFixed(1) + '%' : 'N/A'
    const nonsysR = capm ? (capm.nonsysRisk * 100).toFixed(1) + '%' : 'N/A'
    const r2 = capm ? (capm.rSquared * 100).toFixed(1) + '%' : 'N/A'

    const prompt = `角色：你现在是一位兼具"深度基本面研究（兼顾CANSLIM思想）"与"通达信/同花顺高级技术分析、多因子风控"能力的对冲基金投资总监（CIO）兼明星交易员。

当前日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}。注意：以下"一致预期"数据中的FY1/FY2/FY3指的是分析师对未来财年的预测，而非过去。请基于年份标签准确理解数据的时间维度。

任务：请结合我提供的【目标个股基本面、技术面及量化风控的完整截面数据】，严格依据我独创的【基本面六维度投资逻辑评分体系】进行打分，并结合技术面动能进行全方位深度穿透分析。最终，请按照我给出的【输出模板】输出一份综合诊断的个股综合评分与交易执行白皮书。

---
### 一、 目标个股当前全维度数据

1. 账户信息与技术面特征：
- 股票名称/代码：${name} / ${tsCode}
- 我的持仓股数：${shares}股
- 我的成本价：${cost} 元
- 当前最新价：${curPrice.toFixed(2)} 元
- 持仓市值：${mktVal.toFixed(0)} 元
- 浮动盈亏：${profitAmt} 元 (${profitPct}%)
- 最近成交量特征：${describeVolume(volumes, closes)}
- 均线状态：${describeMA(closes, ma5, ma20, ma60)}
- 技术指标：
  - MACD：${describeMACD(dif, deaArr, macdBar)}
  - KDJ(25,3,3)：${describeKDJ(kVal, dVal, jVal)}

2. 风险与量化特征指标：
- 滚动Alpha (年化)：${alpha}
- 滚动Beta：${beta}
- 系统风险值(年化)：${sysR}
- 非系统风险值(年化)：${nonsysR}
- 决定系数 R²：${r2}

3. 估值天花板与终局推演（跨折现率、跨年限矩阵）：
${valBlock}

4. 业务、行业与基本面补充背景资料：
${fBlock}

---
### 二、 我的基本面投资逻辑评分标准

请严格依据以下标准进行量化打分和扣分，必须写明每一项的打分依据：

1. 行业景气度 (20%)：高度景气(90-100分，未来3年CAGR>20%且契合国家战略)；较好景气(70-89分，增长10-20%)；中性(50-69分，0-10%)；承压(30-49分)；衰退(0-29分)。
2. 业务驱动纯度 (30%)：>90%得90-100分；80-90%得75-89分；60-80%得60-74分；<60%得40-59分。多元化无协同扣10-20分，频繁并购扣10分，营业外收入占比>20%扣15分。
3. 业绩增长确定性 (20%)：根据公式 YoY = (预期EPS - 历史EPS)/历史EPS × 100% 计算增速。>100%得95-100分；50-100%得80-94分；30-50%得65-79分；10-30%得50-64分；<0得0-29分。连续2年>50%加5分，连续3年>30%加10分。
4. 市场关注度与辨识度 (15%)：绝对龙头90-100分；前三有定价权75-89分；细分龙头60-74分；二三线40-59分。机构调研>50次/年加5分；研报覆盖>10家加5分；北向持股>5%加5分。
5. 估值安全性 (15%)：根据公式 PEG = PE / 预期净利润增速(G) 计算。PEG<0.5得90-100分；0.5-0.8得75-89分；0.8-1.2得60-74分；1.2-1.5得40-59分；PEG>1.5得0-39分。若无PEG，按股价历史分位数：低位10%得90-100分；低位30%得70-89分；中位50-69分；高位10%得0-29分。
6. 风险减分项 (最高-20%)：重要股东减持(-5分/次)；技术替代风险(-10分)；毛利率下降>5pct(-8分)；营收下滑(-10分)；净利下滑(-10分)；应收激增(-5分)；存货积压(-5分)；现金流为负(-5分)；客户集中度>40%(-5分)；财务造假嫌疑(-20分)。★★重要：以上"净利下滑/营收下滑/毛利率下降"请以最新季报(Tushare数据)为准，而非仅看年报。若Q1已扭亏为盈，则净利下滑项不扣分。

---
### 三、 "文武结合"四维度深度诊断要求

1. 【技术面与量化基因诊断】
2. 【基本面与量化定价错配验证】
3. 【估值推演：市场对你定了个什么价？是高估还是低估？】
注意：一.3矩阵中的数字全是"市场通过当前股价反推的隐含要求"，不是你的预测。
你的核心任务是：对比这个隐含要求和公司真实能力，判断上下。

a) 市场到底隐含要求了什么？（先算清楚再说）
   - 当前股价=\${…}元。在不同(r,n)组合下：
     * 模型A：市场要求利润XXX年后达到现在的X~X倍，年化增速X%~X%
     * 模型B：市场隐含终局每股年利润 X~X 元
   - 明确标出：悲观端(r偏高,n偏短)市场要求多少？中性(r=10%,n=10)呢？乐观(r偏低,n偏长)呢？

b) 这个要求合理吗？（核心判断）
   - 结合该公司的行业天花板、竞争地位、历史利润增速/利润中枢，
     判断市场隐含的这些要求属于"轻松可达"、"需要努努力"还是"几乎不可能"。
   - 有出海业务的公司：折现率可偏乐观端(风险分散)；周期股：应偏悲观端。
   - 亏损股只看模型B(终局EPS)：市场给出这个隐含终局利润，对比同行业盈利公司合理吗？

c) 结论（必须明确方向）：
   「当前估值状态：市场低估 / 定价合理 / 市场高估 / 严重依赖乐观假设」
   并说明理由：在悲观/中性/乐观三种情景里，哪种最接近你的真实判断？
4. 【安全边际与极端防守测试】

---
### 四、 报告输出模板

请严格、完整地按照以下格式输出：

# [股票名称]([股票代码]) 全维度综合评分与交易策略报告
**评分日期：** [自动生成]
**基本面得分：** [XX]/100分  |  **评级：** [A+/A/B+/B/C+/D/D-]
**技术面状态：** [多头主升浪 / 短线超买震荡 / 蓄势变盘期]
**核心投资逻辑：** [一句话]

---
## 一、基本面六维度评分明细
[六维度表格]

---
## 二、基本面维度详细分析
[①~⑥ 逐维度分析]

---
## 三、技术面与量化特征穿透
[1.账面审计 2.中线量价 3.短线情绪]

---
## 四、投资总监综合交叉诊断意见（含估值天花板与终局推演研判）
[基本面与量化定价错配 + 极端防守测试]

---
## 五、综合投资评级与交易员行动指南
### 本股综合评级：[X]级
### ⚡ 交易员每日行动指令（1-3个交易日）
**执行动作：** 【持股不动 / 逢高减仓 / 突破加仓 / 限价止损】
**核心执行理由：** [理由]
**风险控制边界：**
- 动态止盈位：[XX] 元
- 动态止损位：[XX] 元
- 核心跟踪基本面指标：[1-2个]

请用凌厉、果断、充满实战感的专业交易员视角，为我输出这份单股报告。`

    // ═══ 5. 调用 DeepSeek ═══
    const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 4000 }),
    })
    const aiJson = await aiResp.json()
    const content = aiJson?.choices?.[0]?.message?.content || 'AI 返回为空'
    const summary = extractSummary(content)

    // ═══ 6. 持久化 ═══
    const cacheData = { ts_code: tsCode, name, analysis: content, summary, date: formatDate(new Date()) }
    await saveCache(tsCode, cacheData)

    return { success: true, data: { analysis: content, summary, date: formatDate(new Date()) } }
  } catch (e: any) {
    console.error('[ai-analysis]', e)
    return { success: false, error: e.message }
  }
})
