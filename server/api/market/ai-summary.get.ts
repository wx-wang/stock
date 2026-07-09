/**
 * GET /api/market/ai-summary — DeepSeek AI 大盘总结
 * 缓存：2 小时磁盘
 */
import { DEEPSEEK_API_URL, DEEPSEEK_MODEL } from '../../config'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-ai-summary.json')
const CACHE_TTL = 2 * 3600 * 1000

const SYSTEM_PROMPT = `你是一个专业的 A 股市场分析师。请根据提供的今日多维市场数据，用中文输出纯 JSON（不要 markdown 代码块）：

{
  "headline": "一句话概括今日市场特征（15字以内）",
  "narrative": "综合分析 2-4 句话。必须覆盖：(1) 上证/深证/创业板/科创板四大指数各自的涨跌表现和分化情况 (2) 涨跌家数反映的市场广度 (3) 资金面（北向+融资）判断 (4) 论坛讨论最热的方向与行情是否匹配",
  "breadth": "基于涨跌家数和涨停跌停比，判断是普涨/结构性行情/严重分化。引用具体数字。",
  "trendAlignment": "判断热门板块与大盘趋势是否共振，结合主线检测结果和恐惧贪婪指数。",
  "riskFlags": ["列出 2-3 个值得注意的信号（可以是风险也可以是积极信号），必须引用数据来源"],
  "position": "结合股债利差当前值和历史分位给出仓位建议（如：'利差3.2%在高位→建议积极仓位'），15字以内"
}`

export default defineEventHandler(async (event) => {
  try {
    const force = getQuery(event).force === '1'

    if (!force) {
      const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
      if (cached) {
        const c = JSON.parse(cached)
        if (Date.now() - c._ts < CACHE_TTL) return c
      }
    }

    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.NUXT_DEEPSEEK_API_KEY || ''
    if (!apiKey) {
      console.warn('[ai-summary] 未配置 DEEPSEEK_API_KEY')
      return { headline: 'AI 未配置', narrative: '请在 .env 中设置 DEEPSEEK_API_KEY', breadth: '', trendAlignment: '', riskFlags: [], position: '', _ts: Date.now() }
    }

    const dataCtx = await buildDataContext()
    if (!dataCtx) {
      return { headline: '数据获取失败', narrative: '无法获取市场数据', breadth: '', trendAlignment: '', riskFlags: [], position: '', _ts: Date.now() }
    }

    const resp = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: dataCtx },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    })

    const json = await resp.json() as any
    const content = json?.choices?.[0]?.message?.content || ''

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
    const baseUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const fetchJson = async (path: string) => {
      try {
        const r = await fetch(baseUrl + path)
        const t = await r.text()
        try { return JSON.parse(t) } catch { return null }
      } catch { return null }
    }

    // 并行拉取所有数据源
    const [indices, breadth, hot, forum, position, fg, mainTheme] = await Promise.all([
      fetchJson('/api/market/indices-panel'),
      fetchJson('/api/market/breadth'),
      fetchJson('/api/market/hot-sectors'),
      fetchJson('/api/market/forum-sentiment'),
      fetchJson('/api/market/position'),
      fetchJson('/api/market/fear-greed'),
      fetchJson('/api/market/main-theme'),
    ])

    // ── 1. 各大指数详细数据 ──
    let idxStr = 'N/A'
    if (indices?.indices?.length) {
      idxStr = indices.indices.map((i: any) =>
        `${i.name}(${i.code}): 收盘${i.close}, ${i.pctChg >= 0 ? '+' : ''}${i.pctChg}%, 开盘${i.open}, 最高${i.high}, 最低${i.low}`
      ).join('\n  ')
    }

    // ── 2. 涨跌家数 ──
    let breadthStr = 'N/A'
    if (breadth?.success && breadth.total > 0) {
      const upPct = (breadth.up / breadth.total * 100).toFixed(1)
      breadthStr = `全市场${breadth.total}只股票: ${breadth.up}涨(${upPct}%) / ${breadth.down}跌 / ${breadth.flat}平, 涨停${breadth.upLimit}家, 跌停${breadth.dnLimit}家`
    }

    // ── 3. 热门板块 ──
    let hotStr = 'N/A'
    if (hot?.industries?.length) {
      const topI = hot.industries.slice(0, 5).map((i: any) =>
        `${i.name}(+${i.pctChg?.toFixed(2)}%)`).join(', ')
      const topC = (hot.concepts || []).slice(0, 5).map((c: any) =>
        `${c.name}(+${c.pctChg?.toFixed(2)}%)`).join(', ')
      hotStr = `行业Top5: ${topI}\n  概念Top5: ${topC}`
    }

    // ── 4. 主线检测 ──
    let themeStr = 'N/A'
    if (mainTheme?.success && (mainTheme.industryTheme?.length || mainTheme.conceptTheme?.length)) {
      const it = (mainTheme.industryTheme || []).map((t: any) =>
        `${t.name}(得分${t.score})`).join(', ')
      const ct = (mainTheme.conceptTheme || []).map((t: any) =>
        `${t.name}(得分${t.score}, ${t.narrative})`).join(', ')
      themeStr = `行业主线: ${it}
  概念主线: ${ct}`
    }

    // ── 5. 恐惧贪婪 ──
    let fgStr = 'N/A'
    if (fg?.success) {
      const comps = fg.components || {}
      fgStr = `综合指数${fg.index}分(${fg.label})
  分项: 涨跌比${comps.breadth || '?'}/100, 涨停跌停比${comps.limitRatio || '?'}/100, 北向资金${comps.northFlow || '?'}/100, 融资${comps.marginChange || '?'}/100, 市场宽度${comps.marketWidth || '?'}/100, 量能${comps.volumeRatio || '?'}/100`
    }

    // ── 6. 股债利差（仓位参考的关键数据） ──
    let posStr = 'N/A'
    if (position?.success && position.current) {
      const cur = position.current
      const pct = cur.percentile ?? position.median?.percentile ?? '?'
      const zone = position.zoneLabel || position.zone || '?'
      posStr = `盈余收益率E/P=${cur.ep}%, 10年国债=${cur.bond10y}%, 股债利差=${cur.spread}%, 位于近3年第${pct}分位, 市场阶段=${zone}`
    }

    // ── 7. 论坛舆情 ──
    let forumStr = 'N/A'
    if (forum?.success && forum.summary) {
      const s = forum.summary
      const hotConcepts = (forum.concept_heat || []).slice(0, 5)
        .map((c: any) => `${c.concept}(${c.count}条)`).join(', ')
      const topTopics = (forum.top_topics || []).slice(0, 5)
        .map((t: any) => `[${t.source}] ${t.title}`).join('\n    ')
      forumStr = `市场情绪: ${s.dominant_sentiment}, 话题${s.total_topics}条(国内${s.domestic_forums}+国际${s.international_forums}), 来源: ${(s.forums_crawled || []).join(',')}
  讨论最热概念: ${hotConcepts || '无'}
  热门话题:
    ${topTopics || '无'}`
    }

    return `=== 今日 A 股市场数据 ===

【各大指数表现】
  ${idxStr}

【涨跌广度】
  ${breadthStr}

【热门板块排行】
  ${hotStr}

【主线检测】
  ${themeStr}

【恐惧贪婪指数】
  ${fgStr}

【股债利差 / 市场位置】
  ${posStr}

【论坛舆情雷达】
  ${forumStr}`
  } catch { return null }
}
