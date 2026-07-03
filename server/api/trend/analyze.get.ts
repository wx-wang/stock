/**
 * GET /api/trend/analyze?code=600519&days=250
 *
 * 单股趋势分析：250 天逐日 MA / ATR / 温度 / 节气 / 均线间距 + 信号
 * 内存缓存 5 分钟（keyed by code），无需持久化。
 */

import { getDaily } from '@/server/lib/tushare'

// ========== 类型 ==========

interface DayRow {
  trade_date: string
  open: number
  high: number
  low: number
  close: number
  pct_chg: number
}

interface ComputedDay {
  date: string
  close: number
  open: number
  high: number
  low: number
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  score: number
  temperature: string
  jieqi: string | null
  jieqiDays: number
  rightDays: number
  spread_5_10: number | null
  spread_10_20: number | null
  spread_20_60: number | null
  atr: number | null
}

interface TrendResult {
  success: boolean
  code: string
  name: string
  summary: {
    close: number
    ma5: number | null
    ma10: number | null
    ma20: number | null
    ma60: number | null
    score: number
    temperature: string
    jieqi: string | null
    jieqiDays: number
    rightDays: number
    spreads: {
      '5_10': number | null
      '10_20': number | null
      '20_60': number | null
    }
    atr: number | null
    atrAvg: number | null
    atrRatio: number | null
  }
  series: Array<{
    date: string
    close: number
    open: number
    high: number
    low: number
    ma5: number | null
    ma10: number | null
    ma20: number | null
    ma60: number | null
    score: number
    temperature: string
    jieqi: string | null
    spread_5_10: number | null
    spread_10_20: number | null
    spread_20_60: number | null
    atr: number | null
  }>
  signals: Array<{ type: string; text: string }>
}

// ========== 代码标准化 ==========

function normalizeCode(code: string): string {
  const trimmed = code.trim().toUpperCase()
  // 已有后缀
  if (/\.(SH|SZ)$/.test(trimmed)) return trimmed
  // 6 开头 → 上海
  if (/^[689]/.test(trimmed)) return trimmed + '.SH'
  // 其余 → 深圳
  return trimmed + '.SZ'
}

// ========== 日期工具 ==========

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// ========== SMA ==========

function calcMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j]
    result.push(Math.round((sum / period) * 100) / 100)
  }
  return result
}

// ========== ATR(20) ==========

function calcATR(rows: DayRow[]): { atr: (number | null)[]; atrAvg: number } {
  const atr: (number | null)[] = []
  const period = 20
  const trValues: number[] = []

  for (let i = 0; i < rows.length; i++) {
    const h = rows[i].high
    const l = rows[i].low
    const prevClose = i > 0 ? rows[i - 1].close : rows[i].close
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose))
    trValues.push(tr)

    if (i < period - 1) {
      atr.push(null)
      continue
    }

    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += trValues[j]
    atr.push(Math.round((sum / period) * 100) / 100)
  }

  // 计算全序列 ATR 均值（供 atrRatio 归一化用，排除 null 头部）
  const validAtrs = atr.filter((v): v is number => v != null)
  const atrAvg = validAtrs.length > 0
    ? Math.round((validAtrs.reduce((a, b) => a + b, 0) / validAtrs.length) * 100) / 100
    : 0

  return { atr, atrAvg }
}

// ========== 温度映射 ==========

type Temperature =
  | '沸' | '热' | '温偏热' | '温' | '温偏凉' | '平' | '凉' | '寒'

/** 平及以下（用于立秋判定） */
const FLAT_OR_BELOW: ReadonlySet<string> = new Set(['平', '凉', '寒'])

function computeTemperature(score: number, atrRatio: number, close: number, ma10: number | null, ma20: number | null, ma60: number | null): Temperature {
  if (score === 4) {
    return atrRatio > 1.5 ? '沸' : '热'
  }
  if (score === 3) {
    return (ma10 != null && close > ma10) ? '温偏热' : '温'
  }
  if (score === 2) {
    return (ma20 != null && ma60 != null && ma20 > ma60) ? '温偏凉' : '平'
  }
  if (score === 1) {
    return (ma20 != null && ma60 != null && ma20 > ma60) ? '凉' : '寒'
  }
  return '寒'
}

// ========== 节气状态机 ==========

interface JieqiState {
  jieqi: string | null   // 当前节气名
  jieqiDays: number      // 当前节气持续天数
  rightDays: number      // 右侧趋势总天数
  brokenMA20: boolean    // MA20 是否曾被击穿（阻止 立夏→夏至）
}

function runJieqiStateMachine(computedDays: ComputedDay[]): void {
  const state: JieqiState = {
    jieqi: null,
    jieqiDays: 0,
    rightDays: 0,
    brokenMA20: false,
  }

  for (let i = 0; i < computedDays.length; i++) {
    const d = computedDays[i]
    const close = d.close
    const ma10 = d.ma10
    const score = d.score
    const temp = d.temperature
    const spread20_60 = d.spread_20_60
    const spread5_10 = d.spread_5_10
    const spread10_20 = d.spread_10_20
    const atrRatio = d.atr != null && atrAvgForIndex(i, computedDays) > 0
      ? d.atr / atrAvgForIndex(i, computedDays)
      : 1

    // ── 立秋 → 下一根 K 线重置 ──
    if (state.jieqi === '立秋') {
      state.jieqi = null
      state.jieqiDays = 0
      state.rightDays = 0
      state.brokenMA20 = false
    }

    // ── 检查立秋触发条件（价格跌破 MA10 或温度平及以下） ──
    const liqiuTrigger =
      (ma10 != null && close < ma10) ||
      FLAT_OR_BELOW.has(temp)

    // ── 状态机主逻辑 ──
    if (state.jieqi == null) {
      // 无右侧 → 立夏
      if (score === 4) {
        state.jieqi = '立夏'
        state.jieqiDays = 1
        state.rightDays = 1
        state.brokenMA20 = false
      }
    } else {
      // 已在某个节气中，先累加天数
      state.jieqiDays++
      state.rightDays++

      // 跟踪 brokenMA20
      if (spread20_60 != null && spread20_60 <= 0) {
        state.brokenMA20 = true
      }

      if (liqiuTrigger) {
        // 立秋 → 记录当前节气为立秋，下根 K 线 reset
        state.jieqi = '立秋'
        // 天数不归零，立秋日保留
      } else {
        // 尝试晋升
        if (state.jieqi === '立夏') {
          if (
            state.rightDays >= 5 &&
            spread20_60 != null &&
            spread20_60 > 0.5 &&
            !state.brokenMA20
          ) {
            state.jieqi = '夏至'
            state.jieqiDays = 1
          }
        } else if (state.jieqi === '夏至') {
          const recent3dAvg = recent3dSpreadAvg(computedDays, i, 'spread_5_10')
          const last10dAvg = trailingSpreadAvg(computedDays, i, 10, 'spread_5_10')
          if (
            state.rightDays >= 10 &&
            recent3dAvg != null &&
            last10dAvg != null &&
            last10dAvg > 0 &&
            recent3dAvg > last10dAvg * 1.3 &&
            spread5_10 != null &&
            spread10_20 != null &&
            spread5_10 > spread10_20 * 0.5
          ) {
            state.jieqi = '小暑'
            state.jieqiDays = 1
          }
        } else if (state.jieqi === '小暑') {
          if (state.rightDays >= 15 && atrRatio > 1.5) {
            state.jieqi = '大暑'
            state.jieqiDays = 1
          }
        }
        // 大暑：不再晋升
      }
    }

    // ── 写入当天结果 ──
    d.jieqi = state.jieqi
    d.jieqiDays = state.jieqiDays
    d.rightDays = state.rightDays
  }
}

/** 获取当前索引对应的全序列 ATR 均值（用于 atrRatio） */
function atrAvgForIndex(_i: number, computedDays: ComputedDay[]): number {
  let sum = 0
  let count = 0
  for (const d of computedDays) {
    if (d.atr != null) { sum += d.atr; count++ }
  }
  return count > 0 ? sum / count : 0
}

/** 最近 3 天某 spread 的均值 */
function recent3dSpreadAvg(days: ComputedDay[], currentIdx: number, key: 'spread_5_10' | 'spread_10_20' | 'spread_20_60'): number | null {
  const vals: number[] = []
  for (let j = Math.max(0, currentIdx - 2); j <= currentIdx; j++) {
    const v = days[j][key]
    if (v != null) vals.push(v)
  }
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** 最近 N 天某 spread 的均值 */
function trailingSpreadAvg(days: ComputedDay[], currentIdx: number, n: number, key: 'spread_5_10' | 'spread_10_20' | 'spread_20_60'): number | null {
  const vals: number[] = []
  for (let j = Math.max(0, currentIdx - n + 1); j <= currentIdx; j++) {
    const v = days[j][key]
    if (v != null) vals.push(v)
  }
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// ========== 信号生成 ==========

function generateSignals(latest: ComputedDay, atrRatio: number | null): Array<{ type: string; text: string }> {
  const signals: Array<{ type: string; text: string }> = []

  // 温度 = 热 or 沸 → 买入信号
  if (latest.temperature === '热') {
    signals.push({ type: 'buy', text: '温度=热 → 可开仓/持有' })
  } else if (latest.temperature === '沸') {
    signals.push({ type: 'buy', text: '温度=沸 → 强势持有/考虑加仓' })
  }

  // ATR > 1.5 倍 + 温度=沸 → 止盈信号
  if (atrRatio != null && atrRatio > 1.5 && latest.temperature === '沸') {
    signals.push({ type: 'warn', text: `ATR 比值 ${atrRatio.toFixed(2)} > 1.5 且温度=沸 → 波动加剧，注意止盈` })
  }

  // P 接近 MA10（<2% 上方）→ 警告
  if (latest.ma10 != null && latest.close > latest.ma10) {
    const pctAboveMA10 = ((latest.close - latest.ma10) / latest.ma10) * 100
    if (pctAboveMA10 < 2) {
      signals.push({
        type: 'warn',
        text: `距立秋触发线(MA10=${latest.ma10}) 仅差 ${pctAboveMA10.toFixed(1)}%`,
      })
    }
  }

  return signals
}

// ========== 多股票名称缓存 ==========

/** 内存名称缓存（从 stock_basic 拉一次，缓存 24h） */
let stockNameMap: Map<string, string> | null = null
let stockNameExpiry = 0

async function getStockName(tsCode: string): Promise<string> {
  // 尝试从内存缓存获取
  const now = Date.now()
  if (!stockNameMap || now > stockNameExpiry) {
    try {
      const { callTushare } = await import('@/server/lib/tushare')
      const items = await callTushare('stock_basic', {}, 'ts_code,name', { ttl: 24 * 3600 * 1000 })
      stockNameMap = new Map<string, string>()
      for (const item of items) {
        stockNameMap.set(item.ts_code as string, item.name as string)
      }
      stockNameExpiry = now + 24 * 3600 * 1000
      console.log(`[trend/analyze] stock_basic 名称缓存已加载，共 ${stockNameMap.size} 条`)
    } catch {
      // 降级：使用 ts_code 作为名称
      stockNameMap = new Map()
      stockNameExpiry = now + 3600 * 1000
    }
  }

  // 从 Map 中查找（支持带/不带后缀）
  if (stockNameMap.has(tsCode)) return stockNameMap.get(tsCode)!
  const bare = tsCode.replace(/\.(SH|SZ)$/, '')
  for (const [k, v] of stockNameMap) {
    if (k.replace(/\.(SH|SZ)$/, '') === bare) return v
  }
  return tsCode
}

// ========== 缓存 ==========

interface CacheEntry {
  data: TrendResult
  expiresAt: number
}

const resultCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

// ========== 主入口 ==========

export default defineEventHandler(async (event): Promise<TrendResult> => {
  try {
    const q = getQuery(event)
    const rawCode = (q.code as string) || ''
    const daysParam = parseInt((q.days as string) || '250', 10)
    const days = Math.max(60, Math.min(daysParam, 500)) // 限制 60-500

    if (!rawCode) {
      return { success: false, code: '', name: '', summary: {} as any, series: [], signals: [] }
    }

    const tsCode = normalizeCode(rawCode)

    // ── 检查缓存 ──
    const cacheKey = `${tsCode}:${days}`
    const cached = resultCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data
    }

    // ── 拉取日线数据 ──
    const endDate = formatDate(new Date())
    const start = new Date()
    start.setDate(start.getDate() - days * 2) // 多取一些冗余，确保有足够交易日
    const startDate = formatDate(start)

    const rawData: DayRow[] = await getDaily(
      tsCode,
      startDate,
      endDate,
      // getDaily 内部已指定 fields，这里参数会被透传；如果需要额外字段，直接信任适配器的字段配置
    ) as any

    if (rawData.length === 0) {
      return {
        success: false,
        code: tsCode,
        name: tsCode,
        summary: {} as any,
        series: [],
        signals: [{ type: 'error', text: '无法获取日线数据，请检查股票代码或网络' }],
      }
    }

    // ── 排序（按 trade_date 升序） ──
    const sorted = rawData
      .map((item: any) => ({
        trade_date: String(item.trade_date || ''),
        open: Number(item.open) || 0,
        high: Number(item.high) || 0,
        low: Number(item.low) || 0,
        close: Number(item.close) || 0,
        pct_chg: Number(item.pct_chg) || 0,
      }))
      .sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1))
      .slice(-days) // 只保留最近 N 天

    if (sorted.length < 20) {
      return {
        success: false,
        code: tsCode,
        name: tsCode,
        summary: {} as any,
        series: [],
        signals: [{ type: 'error', text: `数据不足: 仅 ${sorted.length} 个交易日（需 >= 20）` }],
      }
    }

    // ── 获取股票名称 ──
    const name = await getStockName(tsCode)

    // ── 提取价格序列 ──
    const closes: number[] = sorted.map(d => d.close)

    // ── 计算均线 ──
    const ma5 = calcMA(closes, 5)
    const ma10 = calcMA(closes, 10)
    const ma20 = calcMA(closes, 20)
    const ma60 = calcMA(closes, 60)

    // ── 计算 ATR ──
    const { atr: atrArr, atrAvg: globalAtrAvg } = calcATR(sorted)

    // ── 逐日计算 ──
    const computedDays: ComputedDay[] = []

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]
      const m5 = ma5[i]
      const m10 = ma10[i]
      const m20 = ma20[i]
      const m60 = ma60[i]

      // 均线排列评分（null 视为不满足条件）
      const s0 = (m5 != null && p.close > m5) ? 1 : 0
      const s1 = (m5 != null && m10 != null && m5 > m10) ? 1 : 0
      const s2 = (m10 != null && m20 != null && m10 > m20) ? 1 : 0
      const s3 = (m20 != null && m60 != null && m20 > m60) ? 1 : 0
      const score = s0 + s1 + s2 + s3

      // spreads（百分比）
      const spread_5_10 = (m5 != null && m10 != null && m10 !== 0)
        ? Math.round(((m5 - m10) / m10) * 10000) / 100
        : null
      const spread_10_20 = (m10 != null && m20 != null && m20 !== 0)
        ? Math.round(((m10 - m20) / m20) * 10000) / 100
        : null
      const spread_20_60 = (m20 != null && m60 != null && m60 !== 0)
        ? Math.round(((m20 - m60) / m60) * 10000) / 100
        : null

      // ATR
      const curAtr = atrArr[i]
      const atrRatio = curAtr != null && globalAtrAvg > 0
        ? Math.round((curAtr / globalAtrAvg) * 100) / 100
        : 1

      // 温度
      const temperature = computeTemperature(score, atrRatio, p.close, m10, m20, m60)

      computedDays.push({
        date: formatDateDisplay(p.trade_date),
        close: p.close,
        open: p.open,
        high: p.high,
        low: p.low,
        ma5: m5,
        ma10: m10,
        ma20: m20,
        ma60: m60,
        score,
        temperature,
        jieqi: null,    // 由状态机填充
        jieqiDays: 0,   // 由状态机填充
        rightDays: 0,   // 由状态机填充
        spread_5_10,
        spread_10_20,
        spread_20_60,
        atr: curAtr,
      })
    }

    // ── 运行节气状态机（原地修改 computedDays） ──
    runJieqiStateMachine(computedDays)

    // ── 最新一天 ──
    const latest = computedDays[computedDays.length - 1]

    // ── summary ──
    const summary = {
      close: latest.close,
      ma5: latest.ma5,
      ma10: latest.ma10,
      ma20: latest.ma20,
      ma60: latest.ma60,
      score: latest.score,
      temperature: latest.temperature,
      jieqi: latest.jieqi,
      jieqiDays: latest.jieqiDays,
      rightDays: latest.rightDays,
      spreads: {
        spread_5_10: latest.spread_5_10,
        spread_10_20: latest.spread_10_20,
        spread_20_60: latest.spread_20_60,
      } as { spread_5_10: number | null; spread_10_20: number | null; spread_20_60: number | null },
      atr: latest.atr,
      atrAvg: globalAtrAvg > 0 ? globalAtrAvg : null,
      atrRatio: latest.atr != null && globalAtrAvg > 0
        ? Math.round((latest.atr / globalAtrAvg) * 100) / 100
        : null,
    }

    // ── series（精简字段，不含 jieqiDays/rightDays 内部状态） ──
    const series = computedDays.map(d => ({
      date: d.date,
      close: d.close,
      open: d.open,
      high: d.high,
      low: d.low,
      ma5: d.ma5,
      ma10: d.ma10,
      ma20: d.ma20,
      ma60: d.ma60,
      score: d.score,
      temperature: d.temperature,
      jieqi: d.jieqi,
      spread_5_10: d.spread_5_10,
      spread_10_20: d.spread_10_20,
      spread_20_60: d.spread_20_60,
      atr: d.atr,
    }))

    // ── 信号 ──
    const atrRatioLatest = summary.atr != null && globalAtrAvg > 0
      ? summary.atr / globalAtrAvg
      : null
    const signals = generateSignals(latest, atrRatioLatest)

    // ── 构造结果 ──
    const result: TrendResult = {
      success: true,
      code: tsCode,
      name,
      summary,
      series,
      signals,
    }

    // ── 写入缓存 ──
    resultCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + CACHE_TTL,
    })

    return result
  } catch (e: any) {
    console.error('[trend/analyze]', e)
    return {
      success: false,
      code: '',
      name: '',
      summary: {} as any,
      series: [],
      signals: [{ type: 'error', text: `服务器错误: ${e.message || '未知错误'}` }],
    }
  }
})

// ========== 辅助：将 20250703 格式转为 2025-07-03 ==========

function formatDateDisplay(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}
