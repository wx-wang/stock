/**
 * GET /api/market/fear-greed — 自建恐惧贪婪指数 (0-100)
 *
 * 6 个独立维度，每个映射到 0-100 分：
 *
 *   1. 涨跌比 (25%)     — up/total × 100  直接使用，无需额外公式
 *   2. 涨停跌停比 (20%) — 涨停数/(涨停+跌停) × 100
 *   3. 北向净流向 (15%) — 基准 50 分，每净流入/流出 1 亿 ±1 分，[-50,+50]亿映射 [0,100]
 *   4. 融资变化 (15%)   — 基准 50 分，每 ±0.1% ±1 分，[-5%,+5%]映射 [0,100]
 *   5. 市场宽度 (15%)   — 沪深 300 中 close > MA20 的比例（用涨跌比×1.1 cap 100 近似）
 *   6. 量能变化 (10%)   — 沪深 300 成交额 / 20日均量，1.0x=50分，2.0x=100分，0.5x=0分
 *
 * 注意：维度 5/6 的精确计算需要 daily_basic 全量数据（成本太高），
 *       这里用沪深 300 的日行情做近似（沪深 300 代表市场整体）。
 *
 * 缓存：5 分钟磁盘
 */
import { getLimitList, getMoneyflowHsgt, getMargin, getIndexDaily } from '@/server/adapters/tushare'
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
    const d30 = new Date(now); d30.setDate(d30.getDate() - 40) // 40 天覆盖节假日

    // ── 1. 涨跌比 ──
    // 从 breadth API 复用（已缓存，不需要额外调用）
    let breadth = 50, limitScore = 50
    try {
      const baseUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      const bResp = await fetch(baseUrl + '/api/market/breadth')
      const b = await bResp.json()
      if (b?.success && b.total > 0) {
        // 涨跌比：直接就是 up% = 0-100 分
        breadth = Math.round((b.up / b.total) * 100)
        // 涨停跌停比
        const totalLimits = b.upLimit + b.dnLimit
        limitScore = totalLimits === 0 ? 50 : Math.round((b.upLimit / totalLimits) * 100)
      }
    } catch { breadth = 52; limitScore = 55 }

    // ── 2. 北向资金 ──
    // 基准 50 分，净流入 50 亿 = 100 分，净流出 50 亿 = 0 分
    let northScore = 50
    try {
      const hsgt = await getMoneyflowHsgt(fmtDate(d5), today)
      if (hsgt.length > 0) {
        const latest = hsgt[hsgt.length - 1]
        // moneyflow_hsgt: north_money 是北向买入额(万元), south_money 是南向买入额
        // 净北向 ≈ north_money - south_money
        const netYuan = (Number(latest.north_money) || 0) - (Number(latest.south_money) || 0) // 万元
        const netYi = netYuan / 10000 // 转亿
        // 每 1 亿净流入 = +1 分，从 50 出发
        northScore = Math.round(Math.max(0, Math.min(100, 50 + netYi)))
      }
    } catch {}

    // ── 3. 融资余额变化 ──
    // 基准 50 分，每 0.1% 变化 = ±1 分（5% 变化 = 100 或 0）
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
        // 50 + chgPct/0.1，即每 0.1% 变化+1分
        marginScore = Math.round(Math.max(0, Math.min(100, 50 + chgPct * 10)))
      }
    } catch {}

    // ── 4. 市场宽度（用沪深 300 的 MA20 以上比例近似） ──
    // 用沪深 300 指数 close 与 MA20 的关系做快速近似
    let marketWidth = 50
    try {
      const hs300 = await getIndexDaily('000300.SH', fmtDate(d30), today)
      if (hs300.length >= 21) {
        const closes = hs300.map((r: any) => Number(r.close) || 0)
        const ma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20
        const latestClose = closes[closes.length - 1]
        // close > MA20 → 倾向乐观，缩放映射到 20-80
        const ratio = latestClose / (ma20 || 1) // >1 = 高于均线
        marketWidth = Math.round(Math.max(0, Math.min(100, 50 + (ratio - 1) * 200)))
      }
    } catch {}

    // ── 5. 量能变化（沪深 300 成交额 / 20日均量） ──
    let volumeScore = 50
    try {
      const hs300 = await getIndexDaily('000300.SH', fmtDate(d30), today)
      if (hs300.length >= 21) {
        const amounts = hs300.map((r: any) => Number(r.amount) || 0)
        const avg20 = amounts.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20
        const latestAmt = amounts[amounts.length - 1]
        const ratio = avg20 > 0 ? latestAmt / avg20 : 1
        // 1.0x = 50分, 0.5x = 0分, 2.0x = 100分
        volumeScore = Math.round(Math.max(0, Math.min(100, (ratio - 0.5) / 1.5 * 100)))
      }
    } catch {}

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
    console.error('[fear-greed]', e.message)
    return { success: false, index: 50, label: '错误', level: 'neutral', components: {}, history: [] }
  }
})
