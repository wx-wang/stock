/**
 * GET /api/market/crowding — 大盘拥挤度（成交集中度）
 *
 * 前 5% 个股成交额合计 / 全市场总成交额
 * 国金/开源量化团队经典指标。>30%偏热 >40%拥挤 >50%极度拥挤
 *
 * 数据来源：Tushare daily（全市场日线, 约5000只/天）
 * 缓存：persist/market-crowding.json（30天有效）
 */
import { callTushare } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'

import { PERSIST_DIR } from '../../config'
const CACHE_FILE = path.join(PERSIST_DIR, 'market-crowding.json')

interface DailyConcentration {
  trade_date: string
  top5Pct: number      // 前5%个股成交额合计
  totalAmount: number  // 全市场合计（亿元）
  ratio: number         // 集中度 = top5Pct/totalAmount (%)
}

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const force = q.force === 'true'

    // 读缓存
    if (!force) {
      try {
        const raw = await fs.readFile(CACHE_FILE, 'utf-8')
        const cached = JSON.parse(raw)
        const cacheAge = Date.now() - new Date(cached.updatedAt).getTime()
        if (cacheAge < 30 * 60 * 1000) {  // 30分钟有效
          return cached
        }
      } catch { /* 缓存不存在 */ }
    }

    await fs.mkdir(PERSIST_DIR, { recursive: true })

    // 获取最近 30 个交易日
    const tradingDays = await getRecentTradingDays(30)

    const series: DailyConcentration[] = []

    for (const td of tradingDays) {
      try {
        const rows = await fetchAllDaily(td)
        if (rows.length < 100) {
          console.warn(`[market-crowding] ${td}: only ${rows.length} stocks, skipping`)
          continue
        }

        // 按成交额降序，去除非正数
        const stocks = rows
          .map((r: any) => ({ amount: Number(r.amount) || 0 }))
          .filter(s => s.amount > 0)
          .sort((a, b) => b.amount - a.amount)

        const total = stocks.reduce((s, r) => s + r.amount, 0) / 1e8  // 亿元
        const topN = Math.max(1, Math.round(stocks.length * 0.05))
        const topAmount = stocks.slice(0, topN).reduce((s, r) => s + r.amount, 0) / 1e8

        series.push({
          trade_date: td,
          top5Pct: Math.round(topAmount * 10) / 10,
          totalAmount: Math.round(total * 10) / 10,
          ratio: Math.round(topAmount / Math.max(1, total) * 1000) / 10,
        })
      } catch (e: any) {
        console.warn(`[market-crowding] failed ${td}:`, e.message)
      }
    }

    if (!series.length) {
      return { success: false, error: '无全市场成交数据' }
    }

    // 最新值
    const latest = series[series.length - 1]
    const ratio = latest.ratio

    // 状态判断
    let level: 'cold' | 'normal' | 'warm' | 'hot' | 'extreme' = 'normal'
    let label = '正常'
    let color = '#22AB94'
    if (ratio >= 50) { level = 'extreme'; label = '极度拥挤'; color = '#E15241' }
    else if (ratio >= 40) { level = 'hot'; label = '拥挤'; color = '#F0A030' }
    else if (ratio >= 30) { level = 'warm'; label = '偏热'; color = '#F5C842' }
    else if (ratio < 20) { level = 'cold'; label = '冷清'; color = '#3370FF' }

    const result = {
      success: true,
      updatedAt: new Date().toISOString(),
      latest: { ...latest, level, label, color },
      series: series.slice(-30),
      periods: { days: 30, topPct: 5 },
    }

    await fs.writeFile(CACHE_FILE, JSON.stringify(result, null, 2))
    return result
  } catch (e: any) {
    console.error('[market-crowding]', e)
    return { success: false, error: e.message }
  }
})

/** 拉取全市场某日所有个股成交额（分页） */
async function fetchAllDaily(tradeDate: string): Promise<any[]> {
  const results: any[] = []
  for (let offset = 0; offset < 20000; offset += 4000) {
    const batch = await callTushare('daily',
      { trade_date: tradeDate, limit: 4000, offset },
      'ts_code,amount',
      { ttl: 24 * 3600 * 1000 })  // 日线数据缓存24h
    if (!batch.length) break
    results.push(...batch)
  }
  return results
}

/** 获取最近 N 个交易日日期列表 */
async function getRecentTradingDays(n: number): Promise<string[]> {
  // 从今天往前推 ~50 个自然日，找交易日
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < 80 && dates.length < n; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    // 弱判断：通过 daily 接口试探是否为交易日（存在数据 ≥500 条 = 交易日）
    if (dates.length === 0) {
      dates.push(ds)  // 先推最新一天
      continue
    }
    // 通过 trade_cal 或简单试探
    try {
      const test = await callTushare('daily',
        { trade_date: ds, limit: 1 },
        'ts_code', { ttl: 24 * 3600 * 1000 })
      if (test.length > 0) dates.push(ds)
    } catch { /* 非交易日跳过 */ }
  }
  return dates.sort()
}
