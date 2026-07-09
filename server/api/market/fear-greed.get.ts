/**
 * GET /api/market/fear-greed — 自建恐惧贪婪指数 (0-100)
 *
 * 4 个独立维度，全部从已有数据源计算，无需 Tushare 额外权限：
 *   1. 涨跌比 (35%)      — breadth API → 上涨家数占比
 *   2. 涨停跌停比 (25%)  — breadth API → 涨停占(涨停+跌停)比
 *   3. 沪深300涨跌 (25%) — indices-panel 缓存 → (close-preClose)/preClose 映射到 0-100
 *   4. 成交额 (15%)      — indices-panel 缓存 → HS300 成交额绝对水平
 *
 * 缓存：5 分钟磁盘（仅用于避免同次页面刷新重复计算）
 */
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-fear-greed.json')
const CACHE_TTL = 5 * 60 * 1000

function clamp100(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)))
}

export default defineEventHandler(async () => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return c
    }

    const now = new Date()
    const today = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`

    // ── 维度 1+2: 涨跌比 + 涨停跌停比 ──
    let breadth = 50, limitScore = 50
    try {
      const baseUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      const bResp = await fetch(baseUrl + '/api/market/breadth')
      const b = await bResp.json()
      if (b?.success && b.total > 0) {
        breadth = clamp100((b.up / b.total) * 100)
        const totalLimits = b.upLimit + b.dnLimit
        limitScore = totalLimits === 0 ? 50 : clamp100((b.upLimit / totalLimits) * 100)
      }
    } catch (e: any) {
      console.error('[fear-greed] breadth:', e.message)
    }

    // ── 维度 3+4: 沪深300涨跌 + 成交额（读 indices-panel 缓存） ──
    let hs300Score = 50, volScore = 50
    try {
      const idxRaw = await fs.readFile(path.join(PERSIST_DIR, 'market-indices.json'), 'utf-8').catch(() => null)
      if (idxRaw) {
        const hs300 = JSON.parse(idxRaw).indices?.find((i: any) => i.code === '000300.SH')
        if (hs300?.close > 0) {
          // 今日涨跌幅
          const preClose = Number(hs300.preClose) || hs300.close
          const pctChg = preClose > 0 ? ((hs300.close - preClose) / preClose) * 100 : 0
          hs300Score = clamp100(50 + pctChg * 25)
          console.log(`[fear-greed] HS300 ${pctChg > 0 ? '+' : ''}${pctChg.toFixed(2)}% → ${hs300Score}`)

          // 成交额（沪深300日均约 3000亿，以此为基准 50 分，每多 500 亿 +10 分）
          const amtYi = (Number(hs300.amount) || 0) / 1e8
          volScore = clamp100(50 + (amtYi - 3000) / 500 * 10)
          console.log(`[fear-greed] HS300 成交额 ${amtYi.toFixed(0)}亿 → ${volScore}`)
        }
      }
    } catch (e: any) {
      console.error('[fear-greed] indices-panel read:', e.message)
    }

    // ── 加权合成 ──
    const index = Math.round(
      breadth     * 0.35 +
      limitScore  * 0.25 +
      hs300Score  * 0.25 +
      volScore    * 0.15
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
      history = JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8')).history || []
    } catch {}
    const last = history[history.length - 1]
    if (!last || last.date !== today) history.push({ date: today, index })
    if (history.length > 90) history = history.slice(-90)

    const result = {
      success: true, index, label, level,
      components: { breadth, limitRatio: limitScore, hs300Chg: hs300Score, volume: volScore },
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
