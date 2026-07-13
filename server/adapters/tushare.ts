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

  if (!TUSHARE_URL || !TUSHARE_TOKEN) {
    console.error(`[tushare] missing config: api=${apiName} urlSet=${TUSHARE_URL ? 'yes' : 'no'} tokenLen=${TUSHARE_TOKEN.length}`)
  }

  const json = await httpPostJson(TUSHARE_URL, body, 60)

  // 标准化响应格式 → 统一返回对象数组
  let items: any[] = []
  if (!json) {
    // curl 失败或 JSON 解析失败
    console.error(`[tushare] empty response: api=${apiName} urlSet=${TUSHARE_URL ? 'yes' : 'no'} tokenLen=${TUSHARE_TOKEN.length}`)
  } else if (json.code && json.code !== 0) {
    console.error(`[tushare] api error: api=${apiName} code=${json.code} msg=${json.msg || ''}`)
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

  if (json && items.length === 0) {
    console.error(`[tushare] no items: api=${apiName} code=${json.code ?? 'n/a'} msg=${json.msg || ''} dataKeys=${json.data ? Object.keys(json.data).join(',') : 'none'}`)
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

/** 中债国债收益率曲线（yc_cb），curve_term=10 即 10年期 */
export function getBondYield(startDate: string, endDate: string): Promise<any[]> {
  return callTushare('yc_cb',
    { ts_code: '1001.CB', curve_type: '0', start_date: startDate, end_date: endDate, curve_term: 10 },
    'trade_date,curve_term,yield',
    { ttl: 12 * 3600 * 1000 })  // 12h 缓存，国债日频足够
}

/** 全市场 daily_basic（不传 ts_code = 取全量），用于加权 PE */
export function getDailyBasicAll(tradeDate: string): Promise<any[]> {
  return callTushare('daily_basic', { trade_date: tradeDate },
    'ts_code,trade_date,close,pe_ttm,total_mv', { ttl: 30 * 60 * 1000 })  // 30min TTL
}

export function getIndexClassify(level = 'L2', src = 'SW2021'): Promise<any[]> {
  return callTushare('index_classify', { level, src },
    'index_code,industry_name,level,industry_code,is_pub,parent_code,src', { ttl: 24 * 3600 * 1000 })
}

/** 申万行业指数技术因子（含成交额） — 支持日期范围，每次最多8000行 */
export async function getIdxFactorPro(startDate: string, endDate: string, fields?: string): Promise<any[]> {
  // 日期范围查询，单次最多8000行，分段获取
  const all: any[] = []
  const start = new Date(startDate.slice(0,4)+'-'+startDate.slice(4,6)+'-'+startDate.slice(6,8))
  const end = new Date(endDate.slice(0,4)+'-'+endDate.slice(4,6)+'-'+endDate.slice(6,8))

  // 每次取 ~60天 × ~130行业 ≈ 7800行 < 8000，安全
  let chunkStart = new Date(start)
  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart)
    chunkEnd.setDate(chunkEnd.getDate() + 60)
    if (chunkEnd > end) chunkEnd.setTime(end.getTime())

    const s = fmtDate(chunkStart)
    const e = fmtDate(chunkEnd)

    const batch = await callTushare('idx_factor_pro',
      { start_date: s, end_date: e },
      fields || 'ts_code,trade_date,amount,vol,pct_change',
      { ttl: 24 * 60 * 60 * 1000 })
    all.push(...batch)

    chunkStart = new Date(chunkEnd)
    chunkStart.setDate(chunkStart.getDate() + 1)
  }
  return all
}

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** 申万行业指数批量日线（旧方法，无amount，保留兼容） */
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

// ========== 大盘分析新增方法 ==========

/** 同花顺板块指数列表（概念/行业） */
export function getThsIndex(type: 'N' | 'I' | 'R' | 'S' | 'ST' | 'TH' | 'BB'): Promise<any[]> {
  return callTushare('ths_index', { type, exchange: 'A' },
    'ts_code,name,count,type', { ttl: 24 * 3600 * 1000 })
}

/** 同花顺板块日行情 */
export function getThsDaily(tsCode: string, startDate: string, endDate: string): Promise<any[]> {
  return callTushare('ths_daily', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,trade_date,close,open,high,low,pre_close,pct_change,vol,total_mv,float_mv',
    { ttl: 30 * 60 * 1000 })
}

/** 同花顺板块日行情（批量，用逗号分隔 ts_code） */
export async function getThsDailyBatch(tsCodes: string[], date: string): Promise<Map<string, any>> {
  const result = new Map<string, any>()
  const CHUNK = 100  // ths_daily 单次 max 3000, 100概念 × 1天 = 安全
  for (let i = 0; i < tsCodes.length; i += CHUNK) {
    const chunk = tsCodes.slice(i, i + CHUNK)
    const items = await callTushare('ths_daily',
      { ts_code: chunk.join(','), trade_date: date },
      'ts_code,trade_date,close,pct_change,vol,total_mv', { ttl: 30 * 60 * 1000 })
    for (const item of items) result.set(item.ts_code, item)
  }
  return result
}

/** 涨跌停列表 */
export function getLimitList(tradeDate: string, limitType: 'U' | 'D'): Promise<any[]> {
  return callTushare('limit_list_d', { trade_date: tradeDate, limit_type: limitType },
    'ts_code,trade_date,limit', { ttl: 4 * 3600 * 1000 })
}

/** 融资融券日数据 */
export function getMargin(tradeDate: string): Promise<any[]> {
  return callTushare('margin', { trade_date: tradeDate },
    'trade_date,rzye,rqye,rzmre,rqmcl', { ttl: 4 * 3600 * 1000 })
}

/** 沪深港通资金流（Tushare moneyflow_hsgt 参数是 trade_date 单日） */
export function getMoneyflowHsgt(startDate: string, endDate: string): Promise<any[]> {
  // moneyflow_hsgt API 只接受 trade_date 单日参数，逐日拉取后合并
  return (async () => {
    const start = new Date(Number(startDate.slice(0,4)), Number(startDate.slice(4,6))-1, Number(startDate.slice(6,8)))
    const end = new Date(Number(endDate.slice(0,4)), Number(endDate.slice(4,6))-1, Number(endDate.slice(6,8)))
    const results: any[] = []
    const d = new Date(start)
    while (d <= end) {
      const dt = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
      const items = await callTushare('moneyflow_hsgt', { trade_date: dt },
        'trade_date,north_money,south_money', { ttl: 4 * 3600 * 1000 })
      results.push(...items)
      d.setDate(d.getDate() + 1)
    }
    return results
  })()
}

/** 全市场日行情（不传 ts_code = 全量），用于涨跌家数 */
export function getDailyAll(tradeDate: string): Promise<any[]> {
  return callTushare('daily', { trade_date: tradeDate },
    'ts_code,pct_chg', { ttl: 4 * 3600 * 1000 })
}
