/**
 * services/screener.ts — 股票筛选业务逻辑
 *
 * 编排数据拉取 → 合并 → DCF/PEG 计算 → 分组统计。
 * 不直接发 HTTP 请求（由 adapters 层负责）。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PERSIST_DIR } from '../config'
import { fetchAnalystForecasts } from '../adapters/eastmoney'
import { getDailyBasic, getLatestTradeDate } from '../adapters/tushare'
import {
  computeDcf, computePeg, computeGrowth, computeWeightedPE,
  computeImpliedGrowth, computeTerminalEps,
} from './dcf-valuator'

// ========== 类型 ==========

export interface ScreenerStock {
  code: string; name: string
  close: number; peTtm: number; totalMv: number
  preClose: number  // 上次缓存的收盘价，用于算涨跌幅
  reports: number
  eps1: number; eps2: number; eps3: number; eps4: number
  fy2Eps: number; fy2Growth: number; fy2Year: number
  fy3Eps: number; fy3Growth: number; fy3Year: number
  fy4Eps: number; fy4Growth: number; fy4Year: number
  buyRating: number; addRating: number; targetPrice: number
  dcfValue: number; dcfUpside: number
  targetUpside: number  // (目标价/现价-1)%
  peg: number
  goldenCount12m: number  // 近12月被选为金股次数
  isGoldenRecent: boolean // 最近月份是否为券商金股
  staticPe: number        // 静态PE（市值/去年净利润）
  growthCeiling: number   // 成长天花板 = (1+g)^10
  estimatedPe: number     // 预估PE_TTM = 静态PE / (1+g)
  ceilingEps: number     // 天花板EPS = 天花板 × 上年度EPS
  terminalEps: number   // 终局EPS = 线性增长模型反推终局每股利润
  terminalPe: number    // 终局PE = 当前股价 / 终局EPS
  industryName: string
}

export interface ScreenerGroup {
  industryName: string
  count: number
  avgPe: number
  avgGrowth: number
  avgPeg: number
  stocks: ScreenerStock[]
}

export interface ScreenerResult {
  success: boolean
  updatedAt: string
  totalStocks: number
  groupCount: number
  marketPE: number
  discountRate: number
  groups: ScreenerGroup[]
  error?: string
}

// ========== 辅助 ==========

function toTsCode(code: string): string {
  if (code.startsWith('6') || code.startsWith('9') || code.startsWith('8')) return code + '.SH'
  return code + '.SZ'
}

const CACHE_FILE = path.join(PERSIST_DIR, 'screener-overview.json')
const GOLDEN_CACHE_FILE = path.join(PERSIST_DIR, 'broker-golden.json')

function fmtDate8(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
function parseDate8(s: string): Date {
  return new Date(parseInt(s.slice(0, 4)), parseInt(s.slice(4, 6)) - 1, parseInt(s.slice(6, 8)))
}

// ========== 券商金股标记 ==========

async function loadGoldenMap(): Promise<{ recentSet: Set<string>; countMap: Map<string, number> }> {
  const recentSet = new Set<string>()
  const countMap = new Map<string, number>()
  try {
    const raw = await fs.readFile(GOLDEN_CACHE_FILE, 'utf-8')
    const d = JSON.parse(raw)
    const months: any[] = d.data || []
    const sorted = [...months].sort((a, b) => String(b.month).localeCompare(String(a.month)))

    for (const m of months) {
      for (const s of (m.stocks || [])) {
        const code = String(s.ts_code || '').replace(/\.(SZ|SH)$/, '')
        if (!code) continue
        countMap.set(code, (countMap.get(code) || 0) + 1)
      }
    }

    // 最近一个月份
    if (sorted.length > 0) {
      for (const s of (sorted[0].stocks || [])) {
        const code = String(s.ts_code || '').replace(/\.(SZ|SH)$/, '')
        if (code) recentSet.add(code)
      }
    }
  } catch {}
  return { recentSet, countMap }
}

// ========== 核心 ==========

/** 读取 SW L3 映射表 */
async function loadL3Mapping(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const raw = await fs.readFile(path.join(PERSIST_DIR, 'sw-l3-mapping.json'), 'utf-8')
    const json = JSON.parse(raw)
    for (const [code, name] of Object.entries(json)) map.set(code, name as string)
  } catch {}
  return map
}

/** 全量刷新并返回结果 */
export async function buildScreener(): Promise<ScreenerResult> {
  try {
    // 1. 拉取东方财富分析师预测
    const emStocks = await fetchAnalystForecasts()

    // 2. 拉取 Tushare 价格数据（基于最新交易日，带 T+1 回退）
    const tsMap = new Map<string, any>()
    try {
      let tradeDate = await getLatestTradeDate()
      const tsCodes = emStocks.map(s => toTsCode(s.SECURITY_CODE))
      let tsItems: any[] = []

      // daily_basic 是 T+1 入库，当天可能还没数据。最多回退 3 个交易日
      for (let retry = 0; retry < 3; retry++) {
        tsItems = await getDailyBasic(tradeDate, tsCodes)
        if (tsItems.length > 0) break
        // 回退一天（跳过周末）
        const d = parseDate8(tradeDate)
        d.setDate(d.getDate() - 1)
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
        tradeDate = fmtDate8(d)
      }
      // 返回对象数组：{ts_code, close, pe_ttm, total_mv, ...}
      for (const item of tsItems) {
        const code = (item.ts_code || '').replace(/\.(SZ|SH)$/, '')
        tsMap.set(code, {
          close: Number(item.close) || 0,
          peTtm: Number(item.pe_ttm) || 0,
          staticPe: Number(item.pe) || 0,
          totalMv: Number(item.total_mv) || 0,
        })
      }
    } catch (e: any) { console.error('[screener] Tushare failed:', e.message) }

    // 3. 加载 SW L3 映射 + 金股标记
    const [l3Map, { recentSet, countMap }] = await Promise.all([loadL3Mapping(), loadGoldenMap()])

    // 4. 合并
    // 读取旧缓存获取 preClose（用于算涨跌幅）
    const oldCloseMap = new Map<string, number>()
    try {
      const oldRaw = await fs.readFile(CACHE_FILE, 'utf-8')
      const oldData = JSON.parse(oldRaw)
      for (const g of (oldData.groups || [])) {
        for (const s of (g.stocks || [])) oldCloseMap.set(s.code, s.close || 0)
      }
    } catch {}

    const stocks: ScreenerStock[] = []
    for (const em of emStocks) {
      const code = em.SECURITY_CODE
      const ts = tsMap.get(code) || { close: 0, peTtm: 0, staticPe: 0, totalMv: 0 }

      const eps1 = Number(em.EPS1) || 0
      const eps2 = Number(em.EPS2) || 0
      const eps3 = Number(em.EPS3) || 0
      const eps4 = Number(em.EPS4) || 0

      stocks.push({
        code,
        name: em.SECURITY_NAME_ABBR || code,
        close: ts.close,
        preClose: oldCloseMap.get(code) || 0,
        peTtm: ts.peTtm,
        staticPe: ts.staticPe || 0,
        totalMv: ts.totalMv > 0 ? ts.totalMv / 1e4 : 0,
        reports: em.RATING_ORG_NUM || 0,
        eps1, eps2, eps3, eps4,
        fy2Eps: eps2,
        fy2Growth: computeGrowth(eps1, eps2),
        fy2Year: Number(em.YEAR2) || 0,
        fy3Eps: eps3,
        fy3Growth: computeGrowth(eps2, eps3),
        fy3Year: Number(em.YEAR3) || 0,
        fy4Eps: eps4,
        fy4Growth: computeGrowth(eps3, eps4),
        fy4Year: Number(em.YEAR4) || 0,
        buyRating: em.RATING_BUY_NUM || 0,
        addRating: em.RATING_ADD_NUM || 0,
        targetPrice: em.DEC_AIMPRICEMAX || 0,
        dcfValue: 0, dcfUpside: 0, targetUpside: 0, peg: 0,
        goldenCount12m: countMap.get(code) || 0,
        isGoldenRecent: recentSet.has(code),
        growthCeiling: 0, estimatedPe: 0, ceilingEps: 0, terminalEps: 0, terminalPe: 0,
        industryName: l3Map.get(code) || em.INDUSTRY_BOARD || '其他',
      })
    }

    // 5. DCF + PEG + 目标价空间
    const marketPE = computeWeightedPE(stocks)
    for (const s of stocks) {
      const dcf = computeDcf({ eps1: s.fy2Eps, eps2: s.fy3Eps, eps3: s.fy4Eps, marketPE }, s.close)
      s.dcfValue = dcf.value
      s.dcfUpside = dcf.upside
      s.peg = computePeg(s.peTtm, [s.fy2Growth, s.fy3Growth, s.fy4Growth])
      if (s.staticPe > 0) {
        s.growthCeiling = computeImpliedGrowth(s.staticPe, 0.10)
        s.estimatedPe = s.growthCeiling > 0 ? Math.round(s.staticPe / Math.pow(s.growthCeiling, 0.1) * 100) / 100 : 0
      if (s.growthCeiling > 0 && s.staticPe > 0 && s.close > 0) {
        const lastEps = s.close / s.staticPe
        s.ceilingEps = Math.round(s.growthCeiling * lastEps * 100) / 100
      }
      }
      if (s.close > 0) {
        s.terminalEps = computeTerminalEps(s.close, 0.10, 10)
        s.terminalPe = s.terminalEps > 0 ? Math.round(s.close / s.terminalEps * 100) / 100 : 0
      }
      s.targetUpside = (s.targetPrice > 0 && s.close > 0) ? Math.round((s.targetPrice / s.close - 1) * 10000) / 100 : 0
    }

    // 6. 分组 + 统计
    const groupMap = new Map<string, ScreenerStock[]>()
    for (const s of stocks) {
      if (!groupMap.has(s.industryName)) groupMap.set(s.industryName, [])
      groupMap.get(s.industryName)!.push(s)
    }

    const groups: ScreenerGroup[] = []
    for (const [industryName, groupStocks] of groupMap) {
      const p = groupStocks.filter(s => s.peTtm > 0)
      const g = groupStocks.filter(s => s.fy2Eps > 0 && s.fy2Growth !== 0)
      const avgPe = p.length > 0 ? p.reduce((a, b) => a + b.peTtm, 0) / p.length : 0
      const avgGrowth = g.length > 0 ? g.reduce((a, b) => a + b.fy2Growth, 0) / g.length : 0
      const avgPeg = avgPe > 0 && avgGrowth > 0 ? Math.round(avgPe / avgGrowth * 100) / 100 : 0

      groupStocks.sort((a, b) => b.totalMv - a.totalMv)
      groups.push({
        industryName,
        count: groupStocks.length,
        avgPe: Math.round(avgPe * 10) / 10,
        avgGrowth: Math.round(avgGrowth * 10) / 10,
        avgPeg,
        stocks: groupStocks,
      })
    }
    groups.sort((a, b) => b.count - a.count)

    const r = marketPE > 0 ? 1 / marketPE : 0

    const result: ScreenerResult = {
      success: true,
      updatedAt: new Date().toISOString(),
      totalStocks: stocks.length,
      groupCount: groups.length,
      marketPE,
      discountRate: Math.round(r * 10000) / 100,
      groups,
    }

    // 7. 持久化
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    await fs.writeFile(CACHE_FILE, JSON.stringify(result, null, 2), 'utf-8')

    return result
  } catch (e: any) {
    console.error('[screener]', e)
    return { success: false, error: e.message } as any
  }
}

/** 从缓存读取 */
export async function readScreenerCache(): Promise<ScreenerResult | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 清除缓存 */
export async function clearScreenerCache(): Promise<void> {
  try { await fs.unlink(CACHE_FILE) } catch {}
}
