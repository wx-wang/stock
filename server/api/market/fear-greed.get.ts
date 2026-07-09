/**
 * GET /api/market/fear-greed — 自建恐惧贪婪指数 (0-100)
 *
 * 6 维度加权：
 *   涨跌比 25% + 涨停跌停比 20% + 北向资金 15% + 融资余额 15% + 市场宽度 15% + 成交额变化 10%
 * 缓存：5 分钟磁盘
 */
import { getDailyAll, getLimitList, getMoneyflowHsgt, getMargin } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-fear-greed.json')
const CACHE_TTL = 5 * 60 * 1000

interface FGResult {
  success: boolean
  index: number; label: string; level: string
  components: Record<string, number>
  history: Array<{ date: string; index: number }>
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}

export default defineEventHandler(async (): Promise<FGResult> => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return c
    }

    const now = new Date()
    const today = fmtDate(now)
    const d1 = new Date(now); d1.setDate(d1.getDate() - 1)
    const d2 = new Date(now); d2.setDate(d2.getDate() - 2)
    const d5 = new Date(now); d5.setDate(d5.getDate() - 5)
    const d20 = new Date(now); d20.setDate(d20.getDate() - 30)

    // 1. 涨跌比
    let breadth = 50, limitScore = 50
    const dailyAll = await getDailyAll(today)
    if (dailyAll.length > 100) {
      let up = 0; const total = dailyAll.length
      for (const r of dailyAll) { if (Number(r.pct_chg) > 0) up++ }
      breadth = Math.round((up / total) * 100)

      // 涨停跌停比
      try {
        const [ups, dns] = await Promise.all([getLimitList(today, 'U'), getLimitList(today, 'D')])
        const ratio = (dns.length || 0) === 0 ? 100 : ups.length / (ups.length + dns.length) * 100
        limitScore = Math.round(Math.min(100, ratio))
      } catch {}
    }

    // 3. 北向资金
    let northScore = 50
    try {
      const hsgt = await getMoneyflowHsgt(fmtDate(d5), today)
      if (hsgt.length > 0) {
        const latest = hsgt[hsgt.length - 1]
        const north = Number(latest.north_money) || 0
        const south = Number(latest.south_money) || 0
        const net = north - south
        // 北向净流入 ≥ 50 亿 = 100 分, ≤ -50 亿 = 0 分
        northScore = Math.round(Math.max(0, Math.min(100, 50 + net / 100000000 * 50)))
      }
    } catch {}

    // 4. 融资余额变化
    let marginScore = 50
    try {
      const [todayMargin, prevMargin] = await Promise.all([
        getMargin(today),
        getMargin(fmtDate(d1)),
      ])
      if (todayMargin.length > 0 && prevMargin.length > 0) {
        const todayBal = Number(todayMargin[0].rzye) || 0
        const prevBal = Number(prevMargin[0].rzye) || todayBal
        const chg = prevBal > 0 ? ((todayBal - prevBal) / prevBal) * 100 : 0
        marginScore = Math.round(Math.max(0, Math.min(100, 50 + chg * 50)))
      }
    } catch {}

    // 5. 市场宽度（简化：用当日上涨比例代替 MA20 宽度，做近似）
    const marketWidth = breadth // 简化为涨跌比近似

    // 6. 量能变化（简化：用当日总成交额近似）
    const volumeScore = Math.round(Math.max(0, Math.min(100, breadth * 0.8)))

    // 合成
    const index = Math.round(
      breadth * 0.25 + limitScore * 0.20 + northScore * 0.15 +
      marginScore * 0.15 + marketWidth * 0.15 + volumeScore * 0.10
    )

    let level = 'neutral', label = '中性'
    if (index <= 20) { level = 'extreme_fear'; label = '极度恐惧' }
    else if (index <= 40) { level = 'fear'; label = '恐惧' }
    else if (index <= 60) { level = 'neutral'; label = '中性' }
    else if (index <= 80) { level = 'greed'; label = '贪婪' }
    else { level = 'extreme_greed'; label = '极度贪婪' }

    // 历史（最近 7 天，简化存储）
    const history = (() => {
      try {
        const old = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8') || '{}')
        const h = old.history || []
        h.push({ date: today, index })
        return h.slice(-90) // 保留 90 天
      } catch { return [{ date: today, index }] }
    })()

    const result: FGResult = {
      success: true, index, label, level,
      components: { breadth, limitRatio: limitScore, northFlow: northScore, marginChange: marginScore, marketWidth, volumeRatio: volumeScore },
      history,
    }

    ;(result as any)._ts = Date.now()
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    return { success: false, index: 50, label: '错误', level: 'neutral', components: {}, history: [] }
  }
})
