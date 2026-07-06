/**
 * GET /api/market/position — 股债利差（全A EP - 10Y国债）
 *
 * 返回：
 *   current — 当前 E/P、国债收益率、股债利差、PE、分位
 *   median  — 历史中位数
 *   zone    — 市场阶段（opportunity / neutral / overvalued）
 *   history — 月度快照序列（用于折线图）
 */

import { getBondYield, getDailyBasicAll } from '@/server/adapters/tushare'
import { computeWeightedPE } from '@/server/services/dcf-valuator'
import { promises as fs } from 'fs'
import path from 'path'

import { PERSIST_DIR } from '../../config'

// ========== 类型 ==========

interface MonthPoint {
  date: string       // YYYYMM
  ep: number         // 1/PE (%)
  bond10y: number    // 10Y 国债收益率 (%)
  spread: number     // ep - bond10y
  pe: number         // 加权 PE
}

interface PositionResult {
  success: boolean
  current: MonthPoint & { percentile: number }
  median: MonthPoint
  zone: 'opportunity' | 'neutral' | 'overvalued'
  zoneLabel: string
  history: MonthPoint[]
  thresholds: {
    opportunity: number   // > 此值 = 机会区
    overvalued: number    // < 此值 = 高估区
    max: number
    min: number
  }
}

// ========== 工具 ==========

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

/** 找出数据存在的最近一个月 */
function lastExistingMonth(candidates: string[]): string | null {
  // 取最新一个
  return candidates.length > 0 ? candidates[candidates.length - 1] : null
}

// ========== 缓存 ==========

const CACHE_FILE = path.join(PERSIST_DIR, 'market-position.json')
const CACHE_TTL = 24 * 3600 * 1000  // 24 小时

// ========== 主入口 ==========

export default defineEventHandler(async (_event): Promise<PositionResult> => {
  try {
    // 读缓存
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8')
      const cached = JSON.parse(raw)
      if (Date.now() - cached._ts < CACHE_TTL) return cached
    } catch { /* 无缓存或过期 */ }

    // ─── 1. 拉国债收益率（近 3 年月度） ───
    const end = new Date()
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - 3)

    const bondRaw = await getBondYield(formatDate(start).replace('-', '') + '01', formatDate(end).replace('-', '') + '06')
    // bondRaw: [{ trade_date, curve_term, yield }, ...]

    // 按 date 分组取第一条（同一天多条 term 我们已 filter curve_term=10）
    const bondMap = new Map<string, number>()
    for (const row of bondRaw as any[]) {
      const dt = String(row.trade_date || '').slice(0, 6)  // YYYYMM
      if (!bondMap.has(dt)) {
        bondMap.set(dt, Number(row.yield) || 0)
      }
    }

    // ─── 2. 生成月度日期列表 ───
    const months: Date[] = []
    const cursor = new Date(start)
    cursor.setDate(1)
    while (cursor <= end) {
      months.push(new Date(cursor))
      cursor.setMonth(cursor.getMonth() + 1)
    }
    const monthStrs = months.map(m => formatDate(m))  // YYYYMM

    // ─── 3. 拉月度加权 PE（按月逐月拉 daily_basic） ───
    const pePoints: Array<{ date: string; pe: number }> = []

    for (const mStr of monthStrs) {
      try {
        // 构造该月第 1 天或已知的最新交易日 → 用 YYYYMMDD 格式
        const [y, mo] = [mStr.slice(0, 4), mStr.slice(4, 6)]
        const testDates = [`${y}${mo}01`, `${y}${mo}02`, `${y}${mo}03`,
                           `${y}${mo}04`, `${y}${mo}05`, `${y}${mo}06`,
                           `${y}${mo}07`, `${y}${mo}08`, `${y}${mo}09`,
                           `${y}${mo}10`,`${y}${mo}11`,`${y}${mo}12`,
                           `${y}${mo}13`,`${y}${mo}14`,`${y}${mo}15`]

        for (const td of testDates) {
          const items = await getDailyBasicAll(td) as any[]
          if (!items || items.length < 100) continue  // 交易日数据不足
          const stocks = items.map((it: any) => ({
            peTtm: Number(it.pe_ttm) || 0,
            totalMv: Number(it.total_mv) || 0,
          })).filter((s: any) => s.peTtm > 0 && s.totalMv > 0)

          if (stocks.length > 100) {
            const pe = computeWeightedPE(stocks)
            pePoints.push({ date: mStr, pe })
            break
          }
        }
      } catch { /* 该月无数据，跳过 */ }
    }

    // ─── 4. 合并月度序列 ───
    const history: MonthPoint[] = []
    for (const pp of pePoints) {
      const bond = bondMap.get(pp.date) || 0
      if (pp.pe > 0 && bond > 0) {
        const ep = (1 / pp.pe) * 100
        history.push({
          date: pp.date,
          ep: Math.round(ep * 100) / 100,
          bond10y: Math.round(bond * 100) / 100,
          spread: Math.round((ep - bond) * 100) / 100,
          pe: pp.pe,
        })
      }
    }

    if (history.length < 6) {
      return { success: false, current: null as any, median: null as any,
        zone: 'neutral', zoneLabel: '数据不足',
        history: [], thresholds: { opportunity: 3, overvalued: 1.5, max: 5, min: 0 } }
    }

    // ─── 5. 计算统计 ───
    const spreads = history.map(h => h.spread).sort((a, b) => a - b)
    const mid = spreads[Math.floor(spreads.length / 2)]
    const p80 = spreads[Math.floor(spreads.length * 0.8)]
    const p20 = spreads[Math.floor(spreads.length * 0.2)]

    // 阈值：上 20% 线 = 机会区, 下 20% 线 = 高估区
    const oppThreshold = p80
    const ovrThreshold = p20

    const current = history[history.length - 1]
    const rank = spreads.filter(s => s <= current.spread).length
    const percentile = Math.round((rank / spreads.length) * 100)

    const epMedian = [...history.map(h => h.ep)].sort((a, b) => a - b)[Math.floor(history.length / 2)]
    const bondMedian = [...history.map(h => h.bond10y)].sort((a, b) => a - b)[Math.floor(history.length / 2)]

    let zone: PositionResult['zone'] = 'neutral'
    let zoneLabel = '平衡区'
    if (current.spread >= oppThreshold) { zone = 'opportunity'; zoneLabel = '机会区' }
    else if (current.spread <= ovrThreshold) { zone = 'overvalued'; zoneLabel = '高估区' }

    const result: PositionResult = {
      success: true,
      current: { ...current, percentile },
      median: {
        date: '',
        ep: Math.round(epMedian * 100) / 100,
        bond10y: Math.round(bondMedian * 100) / 100,
        spread: Math.round(mid * 100) / 100,
        pe: 0,
      },
      zone,
      zoneLabel,
      history,
      thresholds: {
        opportunity: Math.round(oppThreshold * 100) / 100,
        overvalued: Math.round(ovrThreshold * 100) / 100,
        max: Math.round(spreads[spreads.length - 1] * 100) / 100,
        min: Math.round(spreads[0] * 100) / 100,
      },
    }

    // 写缓存
    result._ts = Date.now()
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    await fs.writeFile(CACHE_FILE, JSON.stringify(result), 'utf-8')

    return result
  } catch (e: any) {
    return {
      success: false,
      current: null as any, median: null as any,
      zone: 'neutral', zoneLabel: '服务器错误',
      history: [],
      thresholds: { opportunity: 3, overvalued: 1.5, max: 5, min: 0 },
    }
  }
})
