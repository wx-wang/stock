/**
 * GET /api/trend/batch
 *
 * 全市场 A 股趋势分析批量计算。
 *
 * 基于 120 个交易日的日线数据，对每只股票计算：
 *   - 均线排列评分（0-4）
 *   - 趋势温度（冻~沸 9 档）
 *   - 趋势节气（五态状态机：立夏→夏至→小暑→大暑→立秋）
 *   - 趋势强度（10 日 ROC 全市场百分位）
 *
 * 缓存策略：
 *   - 日线：persist/trend-daily/{YYYYMMDD}.json — 按交易日缓存，增量拉取
 *   - 最终结果：persist/trend-batch.json — 每天重建一次
 */

import { getStockBasic, callTushare, getDaily } from '@/server/lib/tushare'
import { promises as fs } from 'fs'
import path from 'path'

import { PERSIST_DIR } from '../../config'

// ========== 常量 ==========

const TREND_DAILY_DIR = path.join(PERSIST_DIR, 'trend-daily')
const TREND_CACHE_FILE = path.join(PERSIST_DIR, 'trend-batch.json')
const TRADING_DAYS = 120
const CONCURRENT_BATCH = 5
const ATR_PERIOD = 14
const ATR20_PERIOD = 20
const CANARY_CODE = '000001.SH'  // 上证指数 — 交易日历金丝雀

// ========== 工具函数 ==========

/** 将 Date 格式化为 YYYYMMDD */
function fmtDate8(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** 当前日期的 YYYYMMDD 格式 */
function todayStr(): string {
  return fmtDate8(new Date())
}
const today8 = todayStr

/** 简单移动平均 */
function sma(values: number[], n: number): number {
  if (values.length < n) return NaN
  const start = values.length - n
  let sum = 0
  for (let i = start; i < values.length; i++) sum += values[i]
  return sum / n
}

/** 保留小数 */
function round(n: number, decimals = 2): number {
  if (!isFinite(n) || isNaN(n)) return 0
  const p = 10 ** decimals
  return Math.round(n * p) / p
}

// ========== 日线数据结构 ==========

interface DailyBar {
  ts_code: string
  trade_date: string
  close: number
  open: number
  high: number
  low: number
  pct_chg: number
}

// ========== ATR 计算 ==========

function computeTrueRange(curr: DailyBar, prevClose: number): number {
  const hl = curr.high - curr.low
  const hpc = Math.abs(curr.high - prevClose)
  const lpc = Math.abs(curr.low - prevClose)
  return Math.max(hl, hpc, lpc)
}

/**
 * Wilder's ATR：前 N 根简单平均，之后指数平滑
 * 需要至少 N+1 根 bar（才能算出 N 个 TR）
 */
function computeATR(bars: DailyBar[], n: number): number {
  if (bars.length < n + 1) return NaN

  const trValues: number[] = []
  for (let i = 1; i < bars.length; i++) {
    trValues.push(computeTrueRange(bars[i], bars[i - 1].close))
  }
  if (trValues.length < n) return NaN

  // 初始 ATR = 前 N 个 TR 的简单平均
  let atr = 0
  for (let i = 0; i < n; i++) atr += trValues[i]
  atr /= n

  // 之后指数平滑
  for (let i = n; i < trValues.length; i++) {
    atr = (atr * (n - 1) + trValues[i]) / n
  }
  return atr
}

// ========== 温度映射 ==========

/** 温度 → 优先级（越大越"热"），用于排序 */
const TEMP_PRIORITY: Record<string, number> = {
  '沸': 6,
  '热': 5,
  '温': 4,
  '平': 3,
  '凉': 2,
  '寒': 1,
}

function getTemperature(
  score: number,
  _close: number,
  _ma10: number,
  _ma20: number,
  _ma60: number,
  atrRatio: number,
): string {
  if (score === 4) return isFinite(atrRatio) && atrRatio > 3 ? '沸' : '热'
  if (score === 3) return '温'
  if (score === 2) return '平'
  if (score === 1) return '凉'
  return '寒' // score === 0
}

// ========== 节气状态机 ==========

interface BarSnapshot {
  close: number
  score: number
  temp: string
  ma10: number
  ma20: number
  ma60: number
  atr: number
  atr20: number
  spread_20_60: number
  spread_5_10: number
  spread_10_20: number
}

interface JieqiState {
  jieqi: string
  jieqiDays: number
  rightDays: number
}

/**
 * 逐根 K 线驱动节气状态机。
 *
 * 状态流转：
 *   无右侧 → score==4 → 立夏
 *   立夏   → rightDays>=5 && spread_20_60>0.5 && 未破MA20 → 夏至
 *   夏至   → rightDays>=10 && 短线间距加速 → 小暑
 *   小暑   → rightDays>=15 && ATR爆发 → 大暑
 *   任意   → P<MA10 || temp<=平 → 立秋(下根重置)
 */
function runJieqiMachine(snapshots: BarSnapshot[]): JieqiState {
  let jieqi = ''
  let jieqiDays = 0
  let rightDays = 0
  let neverBrokeMA20 = true

  // 滚动记录，用于加速判断
  const atrList: number[] = []
  const spread5_10List: number[] = []
  const spread10_20List: number[] = []

  for (const bar of snapshots) {
    const { close, score, temp, ma10, ma20, ma60, atr, atr20, spread_20_60, spread_5_10, spread_10_20 } = bar

    atrList.push(atr)
    spread5_10List.push(spread_5_10)
    spread10_20List.push(spread_10_20)

    // ── 立秋已是"过渡态"：下一根 K 线重置 ──
    if (jieqi === '立秋') {
      jieqi = ''
      jieqiDays = 0
      rightDays = 0
      neverBrokeMA20 = true
      // fall through to check normal transitions below
    }

    // ── 重置条件：P < MA10 或 温度 <= 平 ──
    if (jieqi && jieqi !== '立秋') {
      const tempPri = TEMP_PRIORITY[temp] ?? 0
      if (close < ma10 || tempPri <= TEMP_PRIORITY['平']) {
        jieqi = '立秋'
        jieqiDays = 1
        continue // 下一根 K 线会重置
      }
    }

    // ── 无右侧 → 立夏：首次 score==4 ──
    if (!jieqi && score === 4) {
      jieqi = '立夏'
      jieqiDays = 1
      rightDays = 1
      neverBrokeMA20 = true
      continue
    }

    // ── 立夏：等待 rightDays>=5 + MA20 未被破 + spread 确认 ──
    if (jieqi === '立夏') {
      jieqiDays++
      rightDays++
      if (close < ma20) neverBrokeMA20 = false

      if (rightDays >= 5 && spread_20_60 > 0.5 && neverBrokeMA20) {
        jieqi = '夏至'
        jieqiDays = 1
      }
      continue
    }

    // ── 夏至：等待 rightDays>=10 + 短线间距加速 ──
    if (jieqi === '夏至') {
      jieqiDays++
      rightDays++

      if (spread5_10List.length >= 10) {
        const recent3 = spread5_10List.slice(-3)
        const recent3Avg = recent3.reduce((a, b) => a + b, 0) / 3
        const last10 = spread5_10List.slice(-10)
        const last10Avg = last10.reduce((a, b) => a + b, 0) / 10

        if (
          rightDays >= 10 &&
          last10Avg > 0 &&
          recent3Avg > last10Avg * 1.3 &&
          spread_5_10 > spread_10_20 * 0.5
        ) {
          jieqi = '小暑'
          jieqiDays = 1
        }
      }
      continue
    }

    // ── 小暑：等待 rightDays>=15 + ATR 爆发 ──
    if (jieqi === '小暑') {
      jieqiDays++
      rightDays++

      const atr20avg = atrList.length >= ATR20_PERIOD
        ? atrList.slice(-ATR20_PERIOD).reduce((a, b) => a + b, 0) / ATR20_PERIOD
        : atrList.reduce((a, b) => a + b, 0) / atrList.length

      if (
        rightDays >= 15 &&
        isFinite(atr20avg) &&
        atr20avg > 0 &&
        isFinite(atr) &&
        atr > atr20avg * 3
      ) {
        jieqi = '大暑'
        jieqiDays = 1
      }
      continue
    }

    // ── 大暑：持续计数 ──
    if (jieqi === '大暑') {
      jieqiDays++
      rightDays++
      continue
    }

    // 无节气状态：不计数
    jieqiDays = 0
    rightDays = 0
  }

  return { jieqi, jieqiDays, rightDays }
}

// ========== 趋势强度（10 日 ROC 全市场 percent rank） ==========

function calcStrength(roc10: number, allRocs: number[]): number {
  if (allRocs.length === 0 || !isFinite(roc10)) return 0
  let below = 0
  for (const r of allRocs) {
    if (r < roc10) below++
  }
  return Math.round((below / allRocs.length) * 100)
}

// ========== 主路由 ==========

export default defineEventHandler(async (_event) => {
  try {
    // ─── 1. 缓存检查：上证指数金丝雀 ───
    // 核心思路：上证指数的交易日历 = 全 A 股日历
    // 上证指数有新数据 → Tushare 更新了 → 重建
    // 上证指数没新数据 → 周末/节假日/盘中 → 用缓存
    await fs.mkdir(PERSIST_DIR, { recursive: true })

    try {
      const cacheRaw = await fs.readFile(TREND_CACHE_FILE, 'utf-8')
      const cached = JSON.parse(cacheRaw)

      if (cached._lastTradeDate) {
        // 拉上证指数最近几天看有没有新交易日
        try {
          const canaryBars = await getDaily(CANARY_CODE, cached._lastTradeDate, today8())
          if (canaryBars && canaryBars.length > 0) {
            // 取出最新交易日
            const dates = (canaryBars as any[]).map((b: any) => String(b.trade_date)).sort()
            const latestCanaryDate = dates[dates.length - 1]

            if (latestCanaryDate === cached._lastTradeDate) {
              // 上证指数没新数据 → 用缓存
              console.log(`[trend/batch] canary check: no new data (last=${cached._lastTradeDate}), returning cache`)
              return cached
            }

            console.log(`[trend/batch] canary check: new data found! cached=${cached._lastTradeDate}, latest=${latestCanaryDate}`)
          } else {
            console.log(`[trend/batch] canary check: no bars from ${cached._lastTradeDate}, rebuilding...`)
          }
        } catch (canaryErr: any) {
          console.warn(`[trend/batch] canary check failed: ${canaryErr.message}, rebuilding...`)
        }
      }
    } catch {
      // 缓存不存在或损坏 → 重建
    }

    console.log('[trend/batch] rebuilding from Tushare...')

    // ─── 2. 获取股票列表 ───
    const stockBasic = await getStockBasic()
    if (!stockBasic.length) {
      return { success: false, error: 'stock_basic 返回为空' }
    }

    // 过滤：保留 SH / SZ 的 A 股（剔除非 A 股后缀）
    const stockMap = new Map<string, string>() // ts_code → name
    for (const s of stockBasic) {
      const tsCode = String(s.ts_code || '')
      if (!tsCode) continue
      // 只保留 .SH 和 .SZ 后缀的股票
      if (!tsCode.endsWith('.SH') && !tsCode.endsWith('.SZ')) continue
      // 剔除北交所（8 开头） — 它们也以 .BJ 结尾，已被上面过滤
      stockMap.set(tsCode, String(s.name || ''))
    }

    console.log(`[trend/batch] stock_basic filtered: ${stockMap.size} A-shares`)

    // ─── 3. 确定 120 个交易日 ───
    const endDate = new Date()
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - 220) // 覆盖约 160 个日历日 = 120 个交易日

    const tradeCalItems = await callTushare(
      'trade_cal',
      {
        exchange: 'SSE',
        start_date: fmtDate8(startDate),
        end_date: fmtDate8(endDate),
        is_open: '1',
      },
      'cal_date',
    )

    const tradingDates = tradeCalItems
      .map((r: any) => String(r.cal_date))
      .sort()
      .slice(-TRADING_DAYS)

    console.log(`[trend/batch] trading dates: ${tradingDates.length} (first=${tradingDates[0]}, last=${tradingDates[tradingDates.length - 1]})`)

    if (tradingDates.length < 60) {
      return { success: false, error: `交易日不足: ${tradingDates.length} 天` }
    }

    // ─── 4. 批量拉取日线（磁盘缓存 + 5 并发） ───
    await fs.mkdir(TREND_DAILY_DIR, { recursive: true })

    // 找出尚未缓存的日期
    const missingDates: string[] = []
    for (const ds of tradingDates) {
      const cachePath = path.join(TREND_DAILY_DIR, `${ds}.json`)
      try {
        await fs.access(cachePath)
      } catch {
        missingDates.push(ds)
      }
    }

    console.log(`[trend/batch] daily cache: ${tradingDates.length - missingDates.length} cached, ${missingDates.length} to fetch`)

    // 分批（每组 5 并发）拉取缺失日期
    for (let i = 0; i < missingDates.length; i += CONCURRENT_BATCH) {
      const batch = missingDates.slice(i, i + CONCURRENT_BATCH)
      const results = await Promise.allSettled(
        batch.map(async (ds) => {
          try {
            const items = await callTushare(
              'daily',
              { trade_date: ds },
              'ts_code,close,open,high,low,pct_chg',
              { cache: false },
            )
            if (items.length > 0) {
              await fs.writeFile(
                path.join(TREND_DAILY_DIR, `${ds}.json`),
                JSON.stringify(items),
                'utf-8',
              )
              console.log(`[trend/batch] cached daily: ${ds} (${items.length} rows)`)
            }
            return { date: ds, count: items.length }
          } catch (e: any) {
            console.warn(`[trend/batch] daily fetch failed for ${ds}:`, e.message)
            return { date: ds, count: 0, error: e.message }
          }
        }),
      )
      // 记录失败的数量
      const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any).error))
      if (failed.length > 0) {
        console.warn(`[trend/batch] batch ${i / CONCURRENT_BATCH + 1}: ${failed.length} failed`)
      }
    }

    // ─── 5. 加载所有交易日的数据并按股票分组 ───
    const stockBars = new Map<string, DailyBar[]>() // ts_code → bars

    for (const ds of tradingDates) {
      const cachePath = path.join(TREND_DAILY_DIR, `${ds}.json`)
      try {
        const raw = await fs.readFile(cachePath, 'utf-8')
        const items: any[] = JSON.parse(raw)
        for (const item of items) {
          const code = String(item.ts_code || '')
          if (!stockMap.has(code)) continue // 不在 A 股列表中
          const bar: DailyBar = {
            ts_code: code,
            trade_date: String(item.trade_date || ds),
            close: Number(item.close) || 0,
            open: Number(item.open) || 0,
            high: Number(item.high) || 0,
            low: Number(item.low) || 0,
            pct_chg: Number(item.pct_chg) || 0,
          }
          if (bar.close <= 0) continue
          if (!stockBars.has(code)) stockBars.set(code, [])
          stockBars.get(code)!.push(bar)
        }
      } catch {
        // 日期无缓存 → 跳过
      }
    }

    console.log(`[trend/batch] grouped ${stockBars.size} stocks with bar data`)

    // ─── 6. 逐股计算指标 ───
    interface StockResult {
      code: string
      name: string
      close: number
      ma5: number
      ma10: number
      ma20: number
      ma60: number
      score: number
      temperature: string
      tempLabel: string
      jieqi: string
      jieqiDays: number
      rightDays: number
      strength: number
      spread_20_60: number
      spread_5_10: number
      spread_10_20: number
      atr: number
      atrRatio: number
      roc10: number
    }

    const results: StockResult[] = []
    const roc10Values: number[] = [] // 用于全市场 strength 排名

    // 第一遍：计算每只股票的 roc10，收集用于排名
    for (const [code, bars] of stockBars) {
      bars.sort((a, b) => a.trade_date.localeCompare(b.trade_date))
      if (bars.length < 11) continue // 至少需要 11 根 bar（roc10 + close_10d_ago）

      const close10dAgo = bars[bars.length - 11].close
      const latestClose = bars[bars.length - 1].close
      if (close10dAgo <= 0) continue
      const roc10 = ((latestClose / close10dAgo) - 1) * 100
      roc10Values.push(roc10)
    }

    // 第二遍：完整计算
    for (const [code, bars] of stockBars) {
      const name = stockMap.get(code) || code

      bars.sort((a, b) => a.trade_date.localeCompare(b.trade_date))

      // 构建每日 snapshots（用于节气状态机）
      const closes: number[] = []
      const snapshots: BarSnapshot[] = []

      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]
        closes.push(bar.close)

        const ma5 = sma(closes, 5)
        const ma10 = sma(closes, 10)
        const ma20 = sma(closes, 20)
        const ma60 = sma(closes, 60)

        const atr14 = computeATR(bars.slice(0, i + 1), ATR_PERIOD)
        const atr20 = computeATR(bars.slice(0, i + 1), ATR20_PERIOD)

        // score: P>MA5 + MA5>MA10 + MA10>MA20 + MA20>MA60
        let score = 0
        if (isFinite(ma5) && bar.close > ma5) score++
        if (isFinite(ma5) && isFinite(ma10) && ma5 > ma10) score++
        if (isFinite(ma10) && isFinite(ma20) && ma10 > ma20) score++
        if (isFinite(ma20) && isFinite(ma60) && ma20 > ma60) score++

        const spread_20_60 = isFinite(ma60) && ma60 > 0 ? ((ma20 / ma60) - 1) * 100 : 0
        const spread_5_10 = isFinite(ma10) && ma10 > 0 ? ((ma5 / ma10) - 1) * 100 : 0
        const spread_10_20 = isFinite(ma20) && ma20 > 0 ? ((ma10 / ma20) - 1) * 100 : 0

        const atrRatio = isFinite(atr20) && atr20 > 0 ? atr14 / atr20 : 0

        const temp = getTemperature(score, bar.close, ma10, ma20, ma60, atrRatio)

        snapshots.push({
          close: bar.close,
          score,
          temp,
          ma10: isFinite(ma10) ? ma10 : 0,
          ma20: isFinite(ma20) ? ma20 : 0,
          ma60: isFinite(ma60) ? ma60 : 0,
          atr: isFinite(atr14) ? atr14 : 0,
          atr20: isFinite(atr20) ? atr20 : 0,
          spread_20_60,
          spread_5_10,
          spread_10_20,
        })
      }

      // 最新一根 bar 的各项值
      const latest = bars[bars.length - 1]
      const lastSnapshot = snapshots[snapshots.length - 1]

      const ma5 = sma(closes, 5)
      const ma10 = sma(closes, 10)
      const ma20 = sma(closes, 20)
      const ma60 = sma(closes, 60)
      const atr14 = computeATR(bars, ATR_PERIOD)
      const atr20 = computeATR(bars, ATR20_PERIOD)
      const atrRatio = isFinite(atr20) && atr20 > 0 ? atr14 / atr20 : 0

      // roc10
      const close10dAgo = bars.length >= 11 ? bars[bars.length - 11].close : NaN
      const roc10 = isFinite(close10dAgo) && close10dAgo > 0
        ? ((latest.close / close10dAgo) - 1) * 100
        : NaN

      // strength (percent rank)
      const strength = calcStrength(roc10, roc10Values)

      // 节气状态机
      const { jieqi, jieqiDays, rightDays } = runJieqiMachine(snapshots)

      // ── 入场/出场信号 ──
      const prevSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null
      // 入场：昨日温 → 今日热或沸
      const entrySignal = prevSnapshot
        ? prevSnapshot.temp === '温' && ['热', '沸'].includes(lastSnapshot.temp)
        : false

      // 出场：昨日温及以上（沸/热/温）→ 今日平及以下（平/凉/寒）
      const exitSignal = prevSnapshot
        ? ['沸', '热', '温'].includes(prevSnapshot.temp) && ['平', '凉', '寒'].includes(lastSnapshot.temp)
        : false

      results.push({
        code: code.replace(/\.(SH|SZ)$/, ''), // 去掉后缀，前端用纯数字
        name,
        close: round(latest.close),
        ma5: round(ma5),
        ma10: round(ma10),
        ma20: round(ma20),
        ma60: round(ma60),
        score: lastSnapshot.score,
        temperature: lastSnapshot.temp,
        tempLabel: lastSnapshot.temp,
        jieqi,
        jieqiDays,
        rightDays,
        strength,
        spread_20_60: round(lastSnapshot.spread_20_60),
        spread_5_10: round(lastSnapshot.spread_5_10),
        spread_10_20: round(lastSnapshot.spread_10_20),
        atr: isFinite(atr14) ? round(atr14) : 0,
        atrRatio: round(atrRatio),
        roc10: round(roc10),
        entrySignal,
        exitSignal,
      })
    }

    // ─── 7. 排序：score 降序 → 温度优先级降序 → code 升序 ───
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const pa = TEMP_PRIORITY[a.temperature] ?? 0
      const pb = TEMP_PRIORITY[b.temperature] ?? 0
      if (pb !== pa) return pb - pa
      return a.code.localeCompare(b.code)
    })

    // ─── 8. 写入缓存并返回 ───
    const lastTradeDate = tradingDates[tradingDates.length - 1] || today8()
    const resultData = {
      success: true,
      updatedAt: new Date().toISOString(),
      total: results.length,
      stocks: results,
      _lastTradeDate: lastTradeDate,
    }

    await fs.writeFile(TREND_CACHE_FILE, JSON.stringify(resultData, null, 2), 'utf-8')
    console.log(`[trend/batch] done: ${results.length} stocks cached to ${TREND_CACHE_FILE}`)

    return resultData
  } catch (e: any) {
    console.error('[trend/batch] fatal error:', e)
    return { success: false, error: e.message || '未知错误' }
  }
})
