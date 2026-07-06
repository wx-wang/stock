/**
 * GET /api/market/position — 股债利差（全A EP - 10Y国债）
 *
 * 两阶段设计：
 *   首次访问 → 瞬间返回 current（1 次 screener 复用 + 1 次 yc_cb）
 *              同时后台异步构建月度历史序列 → 写入磁盘缓存
 *   后续访问 → 直接从缓存返回完整数据（current + history + 统计）
 *
 * 缓存 TTL：7 天（月度数据无需频繁刷新）
 */

import { getBondYield, getDailyBasicAll } from '@/server/adapters/tushare'
import { computeWeightedPE } from '@/server/services/dcf-valuator'
import { promises as fs } from 'fs'
import path from 'path'
import { httpGetJson } from '@/server/infra/http'

import { PERSIST_DIR } from '../../config'

// ========== 类型 ==========

interface MonthPoint {
  date: string; ep: number; bond10y: number; spread: number; pe: number
}

interface PositionResult {
  success: boolean
  building?: boolean
  current: (MonthPoint & { percentile: number }) | null
  median: MonthPoint | null
  zone: 'opportunity' | 'neutral' | 'overvalued'
  zoneLabel: string
  history: MonthPoint[]
  thresholds: { opportunity: number; overvalued: number; max: number; min: number }
}

// ========== 工具 ==========

function fmtYm(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function firstOfMonth(ym: string): string { return ym + '01' }
function midOfMonth(ym: string): string { return ym + '15' }

// ========== 缓存 ==========

const CACHE_FILE = path.join(PERSIST_DIR, 'market-position.json')
const CACHE_TTL = 7 * 24 * 3600 * 1000  // 7 天

let buildingPromise: Promise<void> | null = null

// ========== 快速取当前 PE（复用 screener API 内存数据） ==========

async function getCurrentPE(): Promise<{ pe: number; date: string } | null> {
  try {
    // screener/overview 已有 marketPE，走内部 http 调用复用其内存缓存
    const baseUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const resp = await httpGetJson(baseUrl + '/api/screener/overview', 3)  // 3s 超时，冷启动可能慢
    if (resp?.marketPE && resp.marketPE > 0) {
      return { pe: resp.marketPE, date: fmtYm(new Date()) }
    }
  } catch { /* 降级 */ }

  // 降级：自己拉一次
  const now = new Date()
  for (const td of genDates(now)) {
    const items = await getDailyBasicAll(td) as any[]
    if (items && items.length > 100) {
      const stocks = items
        .map((it: any) => ({ peTtm: Number(it.pe_ttm) || 0, totalMv: Number(it.total_mv) || 0 }))
        .filter((s: any) => s.peTtm > 0 && s.totalMv > 0)
      if (stocks.length > 100) {
        return { pe: computeWeightedPE(stocks), date: fmtYm(now) }
      }
    }
  }
  return null
}

function genDates(d: Date): string[] {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0')
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    .map(dd => `${y}${m}${String(dd).padStart(2, '0')}`)
}

// ========== 异步构建完整历史序列 ==========

async function buildFullCache() {
  const end = new Date()
  const start = new Date(end)
  start.setMonth(start.getMonth() - 24)  // 2 年

  // 拉 2 年国债（一次调用）
  const bondRaw = await getBondYield(fmtYm(start) + '01', fmtYm(end) + '30') as any[]
  const bondMap = new Map<string, number>()
  for (const row of bondRaw) {
    const dt = String(row.trade_date || '').slice(0, 6)
    if (!bondMap.has(dt)) bondMap.set(dt, Number(row.yield) || 0)
  }

  // 生成月份列表
  const months: string[] = []
  const mc = new Date(start)
  mc.setDate(1)
  while (mc <= end) { months.push(fmtYm(mc)); mc.setMonth(mc.getMonth() + 1) }

  // 逐月拉 PE（每个 cron 月只试 2 个日期）
  const pePoints: Array<{ date: string; pe: number }> = []
  for (const ym of months) {
    try {
      for (const td of [firstOfMonth(ym), midOfMonth(ym)]) {
        const items = await getDailyBasicAll(td) as any[]
        if (!items || items.length < 100) continue
        const stocks = items
          .map((it: any) => ({ peTtm: Number(it.pe_ttm) || 0, totalMv: Number(it.total_mv) || 0 }))
          .filter((s: any) => s.peTtm > 0 && s.totalMv > 0)
        if (stocks.length > 100) { pePoints.push({ date: ym, pe: computeWeightedPE(stocks) }); break }
      }
    } catch { /* skip this month */ }
  }

  // 合并
  const history: MonthPoint[] = []
  for (const pp of pePoints) {
    const bond = bondMap.get(pp.date) || 0
    if (pp.pe > 0 && bond > 0) {
      const ep = (1 / pp.pe) * 100
      history.push({ date: pp.date, ep: +ep.toFixed(2), bond10y: +bond.toFixed(2), spread: +(ep - bond).toFixed(2), pe: pp.pe })
    }
  }

  if (history.length < 6) return  // 不够，保留旧缓存

  // 统计
  const spreads = history.map(h => h.spread).sort((a, b) => a - b)
  const mid = spreads[Math.floor(spreads.length / 2)]
  const p80 = spreads[Math.floor(spreads.length * 0.8)]
  const p20 = spreads[Math.floor(spreads.length * 0.2)]
  const current = history[history.length - 1]
  const rank = spreads.filter(s => s <= current.spread).length
  const percentile = Math.round((rank / spreads.length) * 100)
  const epMedian = [...history.map(h => h.ep)].sort((a, b) => a - b)[Math.floor(history.length / 2)]
  const bondMedian = [...history.map(h => h.bond10y)].sort((a, b) => a - b)[Math.floor(history.length / 2)]

  let zone: PositionResult['zone'] = 'neutral', zoneLabel = '平衡区'
  if (current.spread >= p80) { zone = 'opportunity'; zoneLabel = '机会区' }
  else if (current.spread <= p20) { zone = 'overvalued'; zoneLabel = '高估区' }

  const result = {
    success: true,
    current: { ...current, percentile },
    median: { date: '', ep: +epMedian.toFixed(2), bond10y: +bondMedian.toFixed(2), spread: +mid.toFixed(2), pe: 0 },
    zone, zoneLabel, history,
    thresholds: { opportunity: +p80.toFixed(2), overvalued: +p20.toFixed(2), max: +spreads[spreads.length - 1].toFixed(2), min: +spreads[0].toFixed(2) },
    _ts: Date.now(),
  }
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
  await fs.writeFile(CACHE_FILE, JSON.stringify(result), 'utf-8')
  console.log('[market/position] history cache built:', history.length, 'months')
}

// ========== 主入口 ==========

export default defineEventHandler(async (_event): Promise<PositionResult> => {
  try {
    // ── 1. 有缓存 → 直接返回 ──
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8')
      const cached = JSON.parse(raw)
      if (Date.now() - cached._ts < CACHE_TTL) return cached
    } catch { /* no cache */ }

    // ── 2. 快速取当前数据 ──
    const now = new Date()
    const bondRaw = await getBondYield(fmtYm(now) + '01', fmtYm(now) + '30') as any[]
    const bond10y = bondRaw.length > 0 ? Number(bondRaw[bondRaw.length - 1].yield) || 1.7 : 1.7

    const peInfo = await getCurrentPE()
    const pe = peInfo?.pe || 17.65
    const ep = (1 / pe) * 100
    const spread = ep - bond10y

    const currentPoint: MonthPoint & { percentile: number } = {
      date: peInfo?.date || fmtYm(now),
      ep: +ep.toFixed(2),
      bond10y: +bond10y.toFixed(2),
      spread: +spread.toFixed(2),
      pe: +pe.toFixed(2),
      percentile: 50,  // 占位，历史构建完后会更新
    }

    // ── 3. 触发后台构建（非阻塞） ──
    if (!buildingPromise) {
      buildingPromise = buildFullCache().finally(() => { buildingPromise = null })
      console.log('[market/position] background history build started')
    }

    return {
      success: true,
      building: true,
      current: currentPoint,
      median: null,
      zone: 'neutral',
      zoneLabel: '加载中...',
      history: [currentPoint],  // 临时：只显示当前点
      thresholds: { opportunity: 3, overvalued: 1.5, max: 5, min: 0 },
    }
  } catch (e: any) {
    console.error('[market/position] error:', e.message)
    return { success: false, current: null, median: null, zone: 'neutral', zoneLabel: '服务器错误', history: [], thresholds: { opportunity: 3, overvalued: 1.5, max: 5, min: 0 } }
  }
})
