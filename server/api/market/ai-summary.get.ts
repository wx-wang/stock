/**
 * GET /api/market/ai-summary — DeepSeek AI 大盘总结
 * 缓存：4 小时磁盘
 */
import { DEEPSEEK_API_KEY, DEEPSEEK_API_URL, DEEPSEEK_MODEL } from '../../config'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-ai-summary.json')
const CACHE_TTL = 4 * 3600 * 1000

const SYSTEM_PROMPT = `你是一个 A 股市场分析师。根据以下今日市场数据，用中文输出 JSON（不要 markdown 代码块，只输出纯 JSON）：

{
  "headline": "一句话概括今日市场特征（20字以内）",
  "narrative": "2-3 句话描述市场整体表现和特征，覆盖涨跌情况和主线板块表现",
  "breadth": "分析上涨广度：是普涨还是结构性行情还是严重分化，用具体数据支撑",
  "trendAlignment": "主线板块与大盘趋势是否共振，给出判断依据",
  "riskFlags": ["列出1-3个值得注意的风险信号或积极信号"],
  "position": "结合股债利差当前分位，给出仓位参考建议，10字以内"
}`

export default defineEventHandler(async (event) => {
  try {
    // 检查是否强制刷新
    const force = getQuery(event).force === '1'

    if (!force) {
      const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
      if (cached) {
        const c = JSON.parse(cached)
        if (Date.now() - c._ts < CACHE_TTL) return c
      }
    }

    if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === '你的DeepSeek_API_Key') {
      return { headline: 'AI 未配置', narrative: '请在 config.ts 中设置 DEEPSEEK_API_KEY', breadth: '', trendAlignment: '', riskFlags: [], position: '', _ts: Date.now() }
    }

    // 获取市场数据上下文
    const dataCtx = await buildDataContext()
    if (!dataCtx) {
      return { headline: '数据获取失败', narrative: '无法获取市场数据', breadth: '', trendAlignment: '', riskFlags: [], position: '', _ts: Date.now() }
    }

    // 调用 DeepSeek
    const resp = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: dataCtx },
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    })

    const json = await resp.json() as any
    const content = json?.choices?.[0]?.message?.content || ''

    // 解析 JSON（容错）
    let parsed: any = {}
    try {
      const clean = content.replace(/```json\n?|\n?```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      parsed = { headline: content.slice(0, 40) || '分析生成失败', narrative: content.slice(0, 200), breadth: '', trendAlignment: '', riskFlags: [], position: '' }
    }

    const result = { ...parsed, _ts: Date.now() }
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    return { headline: 'AI 调用失败', narrative: e.message, breadth: '', trendAlignment: '', riskFlags: [], position: '', _ts: Date.now() }
  }
})

async function buildDataContext(): Promise<string | null> {
  try {
    // 拉取内部 API 数据（不依赖具体实现）
    const baseUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const fetchJson = async (path: string) => {
      try {
        const r = await fetch(baseUrl + path)
        const t = await r.text()
        try { return JSON.parse(t) } catch { return null }
      } catch { return null }
    }

    const [indices, breadth, hot] = await Promise.all([
      fetchJson('/api/market/indices-panel'),
      fetchJson('/api/market/breadth'),
      fetchJson('/api/market/hot-sectors'),
    ])

    const idxstr = indices?.indices?.map((i: any) => `${i.name}: ${i.close} / ${i.pctChg > 0 ? '+' : ''}${i.pctChg}%`).join('\n') || 'N/A'
    const updown = breadth?.success ? `${breadth.up}涨 / ${breadth.down}跌 / ${breadth.flat}平, 涨停${breadth.upLimit}跌停${breadth.dnLimit}` : 'N/A'
    const hotI = hot?.industries?.slice(0, 3).map((i: any) => `${i.name}(${i.pctChg > 0 ? '+' : ''}${i.pctChg}%)`).join(', ') || 'N/A'
    const hotC = hot?.concepts?.slice(0, 3).map((i: any) => `${i.name}(${i.pctChg > 0 ? '+' : ''}${i.pctChg}%)`).join(', ') || 'N/A'

    return `今日市场数据：
- 主要指数：
${idxstr}
- 涨跌家数: ${updown}
- 热门行业 Top 3: ${hotI}
- 热门概念 Top 3: ${hotC}
- 股债利差: 参考 market/position API
- 情绪指数: 参考 market/fear-greed API`
  } catch { return null }
}
