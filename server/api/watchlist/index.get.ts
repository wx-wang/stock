/**
 * GET /api/watchlist — 自选股行情
 *
 * 价格数据（close/pre_close/pct_chg）：Tushare daily 接口批量拉取，独立于筛选器缓存
 * PE/行业：screener 缓存补充（可选，缓存不可用时留空）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PERSIST_DIR } from '../../config'
import { callTushare, getLatestTradeDate } from '../../adapters/tushare'

const WF = path.join(PERSIST_DIR, 'watchlist.json')
const SF = path.join(PERSIST_DIR, 'screener-overview.json')

/** 日期工具 */
function fmt8(d: Date) { return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}` }
function parse8(s: string) { return new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)) }

export default defineEventHandler(async () => {
  await fs.mkdir(PERSIST_DIR, { recursive: true })

  // 1. 读自选股列表
  const wl = JSON.parse(await fs.readFile(WF, 'utf-8').catch(() => '{"stocks":[]}'))
  const st = (wl.stocks || []) as { ts_code: string; name: string }[]
  if (!st.length) return { success: true, data: { stocks: [], quotes: {} } }

  // 2. screener 缓存（PE + 行业，可选）
  let sMap = new Map<string, any>()
  try {
    const sc = JSON.parse(await fs.readFile(SF, 'utf-8'))
    for (const g of sc.groups || []) for (const s of g.stocks || []) sMap.set(s.code, s)
  } catch {}

  // 3. Tushare daily 批量拉价格（独立于筛选器，含真实 pre_close/pct_chg）
  const dailyMap = new Map<string, any>()
  try {
    let tradeDate = await getLatestTradeDate()
    const tsCodes = st.map(s => s.ts_code)

    // daily 也是 T+1 入库，当天可能没数据，回退最多 3 个交易日
    for (let retry = 0; retry < 3; retry++) {
      const items = await callTushare('daily',
        { ts_code: tsCodes.join(','), trade_date: tradeDate },
        'ts_code,trade_date,close,pre_close,change,pct_chg',
        { cache: true, ttl: 5 * 60 * 1000 },
      )
      if (items.length > 0) {
        for (const item of items) dailyMap.set(item.ts_code, item)
        break
      }
      const d = parse8(tradeDate)
      d.setDate(d.getDate() - 1)
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
      tradeDate = fmt8(d)
    }
  } catch (e: any) {
    console.error('[watchlist] Tushare daily failed:', e.message)
  }

  // 4. 组装结果
  const q: Record<string, any> = {}
  for (const s of st) {
    const daily = dailyMap.get(s.ts_code)
    const code = s.ts_code.replace(/\.(SZ|SH)$/, '')
    const sc = sMap.get(code)

    q[s.ts_code] = {
      name: s.name,
      close: daily ? Number(daily.close) || 0 : 0,
      pre_close: daily ? Number(daily.pre_close) || 0 : 0,
      change: daily ? Number(daily.change) || 0 : 0,
      pct_chg: daily ? Number(daily.pct_chg) || 0 : 0,
      pe: sc?.peTtm || undefined,
      industry: sc?.industryName || '',
    }
  }
  return { success: true, data: { stocks: st, quotes: q } }
})
