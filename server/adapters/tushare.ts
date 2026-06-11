/**
 * adapters/tushare.ts — Tushare 数据源适配器
 *
 * 对上暴露业务方法（getDailyBasic / getStockBasic / ...）
 * 对内依赖 config + infra/http，不直接写 token/url
 */

import { TUSHARE_URL, TUSHARE_TOKEN } from '../config'
import { httpPostJson } from '../infra/http'

// ========== 内存缓存（LRU，短 TTL） ==========
interface CacheEntry { data: any; expiresAt: number }
const memCache = new Map<string, CacheEntry>()
const DEFAULT_TTL = 5 * 60 * 1000  // 5 分钟

function memKey(api: string, params: Record<string, any>, fields: string): string {
  return `${api}_${JSON.stringify(params)}_${fields}`
}

function memGet(key: string): any | null {
  const e = memCache.get(key)
  if (!e || Date.now() > e.expiresAt) { memCache.delete(key); return null }
  return e.data
}

function memSet(key: string, data: any, ttl = DEFAULT_TTL): void {
  memCache.set(key, { data, expiresAt: Date.now() + ttl })
}

// ========== 核心调用 ==========

/** 底层 Tushare API 调用（带缓存） */
export async function callTushare(
  apiName: string,
  params: Record<string, any> = {},
  fields = '',
  opts: { cache?: boolean; ttl?: number } = {}
): Promise<any[]> {
  const { cache = true, ttl } = opts
  const key = memKey(apiName, params, fields)

  if (cache) {
    const cached = memGet(key)
    if (cached) return cached
  }

  const body: Record<string, any> = { api_name: apiName, token: TUSHARE_TOKEN, params }
  if (fields) body.fields = fields

  const json = await httpPostJson(TUSHARE_URL, body, 60)

  // 标准化响应格式 → 统一返回对象数组
  let items: any[] = []
  if (!json) {
    // curl 失败或 JSON 解析失败
  } else if (json.data?.fields && json.data?.items) {
    const fields: string[] = json.data.fields
    items = json.data.items.map((row: any[]) => {
      const obj: Record<string, any> = {}
      fields.forEach((f, i) => { obj[f] = row[i] })
      return obj
    })
  } else if (json.data?.items) {
    items = json.data.items
  } else if (Array.isArray(json.data)) {
    items = json.data
  }

  if (cache && items.length > 0) memSet(key, items, ttl)
  return items
}

// ========== 业务方法 ==========

export function getStockBasic(exchange = ''): Promise<any[]> {
  const params: Record<string, any> = {}
  if (exchange) params.exchange = exchange
  return callTushare('stock_basic', params, 'ts_code,name,area,industry,market,list_date', { ttl: 24 * 3600 * 1000 })
}

export function getDaily(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('daily', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount', { ttl: 5 * 60 * 1000 })
}

/** 批量日线（分块请求） */
export async function getDailyBatch(tsCodes: string[], startDate: string, endDate: string): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>()
  const CHUNK = 50
  for (let i = 0; i < tsCodes.length; i += CHUNK) {
    const chunk = tsCodes.slice(i, i + CHUNK)
    const items = await callTushare('daily', { ts_code: chunk.join(','), start_date: startDate, end_date: endDate },
      'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount', { ttl: 5 * 60 * 1000 })
    for (const item of items) {
      const code = item.ts_code
      if (!result.has(code)) result.set(code, [])
      result.get(code)!.push(item)
    }
  }
  return result
}

export function getDailyBasic(tradeDate: string, tsCodes?: string[]): Promise<any[]> {
  const params: Record<string, any> = { trade_date: tradeDate }
  if (tsCodes?.length) params.ts_code = tsCodes.join(',')
  return callTushare('daily_basic', params, 'ts_code,trade_date,close,pe,pb,pe_ttm,total_mv,turnover_rate', { ttl: 5 * 60 * 1000 })
}

export function getIndexDaily(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('index_daily', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount', { ttl: 5 * 60 * 1000 })
}

export function getIndexClassify(level = 'L2', src = 'SW2021'): Promise<any[]> {
  return callTushare('index_classify', { level, src },
    'index_code,industry_name,level,industry_code,is_pub,parent_code,src', { ttl: 24 * 3600 * 1000 })
}

export function getSwDaily(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('sw_daily', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,trade_date,close,pct_change', { ttl: 5 * 60 * 1000 })
}

export async function getSwDailyBatch(tsCodes: string[], startDate: string, endDate: string): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>()
  const CHUNK = 50
  for (let i = 0; i < tsCodes.length; i += CHUNK) {
    const chunk = tsCodes.slice(i, i + CHUNK)
    const items = await callTushare('sw_daily', { ts_code: chunk.join(','), start_date: startDate, end_date: endDate },
      'ts_code,trade_date,close,pct_change', { ttl: 5 * 60 * 1000 })
    for (const item of items) {
      const code = item.ts_code
      if (!result.has(code)) result.set(code, [])
      result.get(code)!.push(item)
    }
  }
  return result
}

// ========== 交易日历 ==========

/**
 * 获取最新交易日（基于 trade_cal 接口）
 * 缓存 2 小时，交易日不会盘中变化；Tushare 不可达时降级到本地计算
 */
export async function getLatestTradeDate(): Promise<string> {
  const now = new Date()
  const today = fmtDate8(now)
  // 往前推 15 天覆盖长假
  const d = new Date(now); d.setDate(d.getDate() - 15)
  const sDate = fmtDate8(d)

  try {
    const items = await callTushare('trade_cal',
      { exchange: 'SSE', start_date: sDate, end_date: today, is_open: '1' },
      'cal_date', { cache: true, ttl: 2 * 3600 * 1000 },
    )
    if (items.length > 0) {
      const dates = items.map(i => String(i.cal_date)).sort()
      return dates[dates.length - 1]
    }
  } catch {}

  // 降级：本地计算最近交易日
  const fallback = new Date(now)
  while (fallback.getDay() === 0 || fallback.getDay() === 6) fallback.setDate(fallback.getDate() - 1)
  return fmtDate8(fallback)
}

function fmtDate8(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 券商月度金股（broker_recommend） */
export function getBrokerRecommend(month: string): Promise<any[]> {
  return callTushare('broker_recommend', { month }, 'month,broker,ts_code,name', { ttl: 60 * 60 * 1000 })
}

/** 指数成分股（index_member） */
export function getIndexMember(indexCode: string): Promise<any[]> {
  return callTushare('index_member', { index_code: indexCode },
    'index_code,con_code,is_new', { ttl: 24 * 3600 * 1000 })
}

// 财报（暂保留，供后续使用）
export function getIncome(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('income', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,ann_date,end_date,report_type,total_revenue,operate_profit,total_profit,n_income', { ttl: 60 * 60 * 1000 })
}

export function getCashflow(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('cashflow', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,ann_date,end_date,report_type,n_cashflow_act,free_cashflow', { ttl: 60 * 60 * 1000 })
}

export function getBalancesheet(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('balancesheet', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,ann_date,end_date,report_type,total_assets,total_liab,total_hldr_eqy_exc_min_int', { ttl: 60 * 60 * 1000 })
}
