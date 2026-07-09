/**
 * GET /api/market/fear-greed — 自建恐惧贪婪指数 (0-100)
 *
 * 6 个独立维度，每个映射到 0-100 分：
 *   1. 涨跌比 (25%)     — breadth API（✅ 已验证）
 *   2. 涨停跌停比 (20%) — breadth API（✅ 已验证）
 *   3. 北向净流向 (15%) — Tushare moneyflow_hsgt，失败=50
 *   4. 融资变化 (15%)   — Tushare margin，失败=50
 *   5. 市场宽度 (15%)   — 复用 index-kline API 获取 HS300 行情计算 MA20
 *   6. 量能变化 (10%)   — 同上，成交额/20日均量
 *
 * 缓存：5 分钟磁盘
 */
import { getMoneyflowHsgt, getMargin, getIndexDaily } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-fear-greed.json')
const CACHE_TTL = 5 * 60 * 1000

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}

export default defineEventHandler(async () => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return c
    }

    const now = new Date()
    const today = fmtDate(now)
    const d1 = new Date(now); d1.setDate(d1.getDate() - 1)
    const d5 = new Date(now); d5.setDate(d5.getDate() - 5)
    const d35 = new Date(now); d35.setDate(d35.getDate() - 35)

    // ── 维度 1+2: 涨跌比 + 涨停跌停比（复用 breadth API） ──
    let breadth = 50, limitScore = 50
    try {
      const baseUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      const bResp = await fetch(baseUrl + '/api/market/breadth')
      const b = await bResp.json()
      if (b?.success && b.total > 0) {
        breadth = Math.round((b.up / b.total) * 100)
        const totalLimits = b.upLimit + b.dnLimit
        limitScore = totalLimits === 0 ? 50 : Math.round((b.upLimit / totalLimits) * 100)
      }
    } catch (e: any) {
      console.error('[fear-greed] breadth fetch failed:', e.message)
    }

    // ── 维度 3: 北向资金 ──
    let northScore = 50
    try {
      const hsgt = await getMoneyflowHsgt(fmtDate(d5), today)
      if (hsgt.length > 0) {
        const latest = hsgt[hsgt.length - 1]
        const netYuan = (Number(latest.north_money) || 0) - (Number(latest.south_money) || 0)
        const netYi = netYuan / 10000
        northScore = Math.round(Math.max(0, Math.min(100, 50 + netYi)))
        console.log(`[fear-greed] north flow: ${netYi.toFixed(1)}亿 → ${northScore}`)
      }
    } catch (e: any) {
      console.error('[fear-greed] moneyflow_hsgt failed:', e.message)
    }

    // ── 维度 4: 融资余额变化 ──
    let marginScore = 50
    try {
      const [todayMargin, prevMargin] = await Promise.all([
        getMargin(today),
        getMargin(fmtDate(d1)),
      ])
      if (todayMargin.length > 0 && prevMargin.length > 0) {
        const todayBal = Number(todayMargin[0].rzye) || 0
        const prevBal = Number(prevMargin[0].rzye) || todayBal
        const chgPct = prevBal > 0 ? ((todayBal - prevBal) / prevBal) * 100 : 0
        marginScore = Math.round(Math.max(0, Math.min(100, 50 + chgPct * 10)))
        console.log(`[fear-greed] margin: ${chgPct.toFixed(2)}% → ${marginScore}`)
      }
    } catch (e: any) {
      console.error('[fear-greed] margin failed:', e.message)
    }

    // ── 维度 5+6: 市场宽度 + 量能（直调 Tushare index_daily 获取 HS300 行情） ──
    let marketWidth = 50, volumeScore = 50
    try {
      const kline = await getIndexDaily('000300.SH', fmtDate(d35), today)
      if (kline && kline.length >= 21) {
        const closes = kline.map((r: any) => Number(r.close) || 0).filter((c: number) => c > 0)
        const amounts = kline.map((r: any) => Number(r.amount) || 0)

        const ma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20
        const latestClose = closes[closes.length - 1]
        const ratio = latestClose / (ma20 || 1)
        marketWidth = Math.round(Math.max(0, Math.min(100, 50 + (ratio - 1) * 200)))
        console.log(`[fear-greed] HS300 close=${latestClose} MA20=${ma20.toFixed(1)} ratio=${ratio.toFixed(3)} → ${marketWidth}`)

        // 量能
        const avg20Amt = amounts.filter((a: number) => a > 0).slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20
        const latestAmt = amounts[amounts.length - 1]
        const volRatio = avg20Amt > 0 ? latestAmt / avg20Amt : 1
        volumeScore = Math.round(Math.max(0, Math.min(100, (volRatio - 0.5) / 1.5 * 100)))
        console.log(`[fear-greed] HS300 amount latest=${latestAmt} avg20=${avg20Amt.toFixed(1)} ratio=${volRatio.toFixed(2)} → ${volumeScore}`)
      } else {
        console.warn(`[fear-greed] index_daily returned ${kline?.length || 0} rows for 000300.SH`)
      }
    } catch (e: any) {
      console.error('[fear-greed] index_daily failed:', e.message || e)
    }

    // ── 加权合成 ──
    const index = Math.round(
      breadth      * 0.25 +
      limitScore   * 0.20 +
      northScore   * 0.15 +
      marginScore  * 0.15 +
      marketWidth  * 0.15 +
      volumeScore  * 0.10
    )

    let level = 'neutral', label = '中性'
    if (index <= 20) { level = 'extreme_fear'; label = '极度恐惧' }
    else if (index <= 40) { level = 'fear'; label = '恐惧' }
    else if (index <= 60) { level = 'neutral'; label = '中性' }
    else if (index <= 80) { level = 'greed'; label = '贪婪' }
    else { level = 'extreme_greed'; label = '极度贪婪' }

    // ── 历史 ──
    let history: Array<{ date: string; index: number }> = []
    try {
      const old = JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8'))
      history = old.history || []
    } catch {}
    const last = history[history.length - 1]
    if (!last || last.date !== today) history.push({ date: today, index })
    if (history.length > 90) history = history.slice(-90)

    const result = {
      success: true, index, label, level,
      components: { breadth, limitRatio: limitScore, northFlow: northScore, marginChange: marginScore, marketWidth, volumeRatio: volumeScore },
      history, _ts: Date.now(),
    }

    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    console.error('[fear-greed] fatal:', e.message)
    return { success: false, index: 50, label: '错误', level: 'neutral', components: {}, history: [] }
  }
})
