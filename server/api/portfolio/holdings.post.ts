/**
 * POST /api/portfolio/holdings
 * 接收用户持仓列表，返回行情数据 + 组合汇总
 */

import { getDaily, getDailyBasic, getStockBasic } from '@/server/lib/tushare'

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function getRecentTradeDate(): string {
  const d = new Date()
  const day = d.getDay()
  if (day === 0) d.setDate(d.getDate() - 2)
  else if (day === 6) d.setDate(d.getDate() - 1)
  return formatDate(d)
}

// Demo fallback data when Tushare is unavailable
const DEMO_QUOTES: Record<string, any> = {
  '000001.SZ': { name: '平安银行', industry: '银行', close: 11.85, pre_close: 11.62, change: 0.23, pct_chg: 1.98, pe: 5.2 },
  '000333.SZ': { name: '美的集团', industry: '家用电器', close: 72.35, pre_close: 73.10, change: -0.75, pct_chg: -1.03, pe: 14.8 },
  '000858.SZ': { name: '五粮液', industry: '食品饮料', close: 148.20, pre_close: 145.80, change: 2.40, pct_chg: 1.65, pe: 19.5 },
  '002415.SZ': { name: '海康威视', industry: '计算机', close: 32.10, pre_close: 31.55, change: 0.55, pct_chg: 1.74, pe: 24.3 },
  '002594.SZ': { name: '比亚迪', industry: '汽车', close: 310.50, pre_close: 315.20, change: -4.70, pct_chg: -1.49, pe: 28.5 },
  '300750.SZ': { name: '宁德时代', industry: '电力设备', close: 205.80, pre_close: 202.10, change: 3.70, pct_chg: 1.83, pe: 22.1 },
  '600036.SH': { name: '招商银行', industry: '银行', close: 40.52, pre_close: 40.10, change: 0.42, pct_chg: 1.05, pe: 6.8 },
  '600519.SH': { name: '贵州茅台', industry: '食品饮料', close: 1680.00, pre_close: 1695.50, change: -15.50, pct_chg: -0.91, pe: 28.7 },
  '600900.SH': { name: '长江电力', industry: '公用事业', close: 28.65, pre_close: 28.45, change: 0.20, pct_chg: 0.70, pe: 22.5 },
  '601318.SH': { name: '中国平安', industry: '非银金融', close: 48.32, pre_close: 47.85, change: 0.47, pct_chg: 0.98, pe: 9.2 },
  '600276.SH': { name: '恒瑞医药', industry: '医药生物', close: 52.30, pre_close: 53.10, change: -0.80, pct_chg: -1.51, pe: 58.3 },
  '002230.SZ': { name: '科大讯飞', industry: '计算机', close: 48.60, pre_close: 47.20, change: 1.40, pct_chg: 2.97, pe: 105.2 },
  '300059.SZ': { name: '东方财富', industry: '非银金融', close: 16.85, pre_close: 16.45, change: 0.40, pct_chg: 2.43, pe: 35.1 },
  '601012.SH': { name: '隆基绿能', industry: '电力设备', close: 16.20, pre_close: 16.55, change: -0.35, pct_chg: -2.11, pe: 12.5 },
  '000651.SZ': { name: '格力电器', industry: '家用电器', close: 42.18, pre_close: 41.90, change: 0.28, pct_chg: 0.67, pe: 8.3 },
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const holdings: any[] = body?.holdings || []

  if (!holdings.length) {
    return { quotes: {}, summary: null }
  }

  let quotes: Record<string, any> = {}

  try {
    const tradeDate = getRecentTradeDate()
    const today = new Date()
    const startDate = formatDate(new Date(today.getTime() - 10 * 86400000))
    const endDate = formatDate(today)

    const tsCodes = holdings.map(h => h.ts_code)

    // Try Tushare in parallel
    const [dailyAll, dailyBasicResults, stockBasicResults] = await Promise.all([
      Promise.all(tsCodes.map(code => getDaily(code, startDate, endDate))),
      getDailyBasic(tradeDate, tsCodes),
      getStockBasic(),
    ])

    // Build lookup maps
    const basicMap = new Map<string, any>()
    for (const item of stockBasicResults) {
      basicMap.set(item.ts_code || '', item)
    }
    const basicDailyMap = new Map<string, any>()
    for (const item of dailyBasicResults) {
      basicDailyMap.set(item.ts_code || '', item)
    }

    // Build quotes
    for (let i = 0; i < tsCodes.length; i++) {
      const code = tsCodes[i]
      const dailyList = dailyAll[i] || []
      const latest = dailyList[0] || {}
      const basic = basicMap.get(code) || {}
      const bd = basicDailyMap.get(code) || {}

      quotes[code] = {
        ts_code: code,
        name: basic.name || holdings[i].name || code,
        close: Number(latest.close) || 0,
        pre_close: Number(latest.pre_close) || 0,
        change: Number(latest.change) || 0,
        pct_chg: Number(latest.pct_chg) || 0,
        vol: Number(latest.vol) || 0,
        amount: Number(latest.amount) || 0,
        pe: Number(bd.pe || bd.pe_ttm) || undefined,
        pb: Number(bd.pb) || undefined,
        industry: basic.industry || '',
      }
    }

    // Check if we got real data
    const hasRealData = Object.values(quotes).some(q => q.close > 0)
    if (!hasRealData) {
      quotes = {}
    }
  } catch (e) {
    console.error('[holdings] Tushare error, using demo data:', e)
  }

  // Fallback to demo data if no real data
  if (Object.keys(quotes).length === 0) {
    for (const h of holdings) {
      const demo = DEMO_QUOTES[h.ts_code]
      if (demo) {
        quotes[h.ts_code] = {
          ts_code: h.ts_code,
          name: demo.name,
          close: demo.close,
          pre_close: demo.pre_close,
          change: demo.change,
          pct_chg: demo.pct_chg,
          vol: 0,
          amount: 0,
          pe: demo.pe,
          pb: undefined,
          industry: demo.industry,
        }
      }
    }
  }

  // Calculate summary
  let totalMarketValue = 0
  let totalCost = 0
  let totalProfit = 0
  let todayProfit = 0

  for (const h of holdings) {
    const q = quotes[h.ts_code]
    const close = q?.close || 0
    const marketValue = close * h.shares
    const costValue = h.cost * h.shares
    totalMarketValue += marketValue
    totalCost += costValue
    totalProfit += marketValue - costValue
    todayProfit += (q?.change || 0) * h.shares
  }

  const summary = {
    totalMarketValue,
    totalCost,
    totalProfit,
    totalProfitPct: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
    todayProfit,
    todayProfitPct: totalCost > 0 ? (todayProfit / totalCost) * 100 : 0,
  }

  return { quotes, summary }
})
