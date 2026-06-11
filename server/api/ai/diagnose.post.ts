/**
 * POST /api/ai/diagnose
 * 接收持仓数据，调用 DeepSeek API 进行投资组合诊断分析
 *
 * Body 参数：
 *   portfolio - 持仓数据数组（含 ts_code, name, cost, shares, close 等）
 *   apiKey    - （可选）DeepSeek API Key，也可通过环境变量 DEEPSEEK_API_KEY 传入
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

const FALLBACK_RESULT = {
  concentration: '当前无法进行 AI 分析，请稍后重试。持仓集中度需结合行业分布和个股权重综合判断。',
  correlation: '各持仓之间的相关性分析暂时不可用。建议关注不同行业之间的风险分散。',
  valuation: '估值分析暂时不可用。请结合 PE、PB 等指标自行评估。',
  suggestions: '建议：1) 分散行业配置；2) 控制单只股票仓位不超过 20%；3) 定期评估持仓估值水平。',
  risk: '风险提示：市场存在不确定性，请根据自身风险承受能力合理配置资产。以上分析仅供参考，不构成投资建议。',
  timestamp: new Date().toISOString(),
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { portfolio } = body

    if (!portfolio || !Array.isArray(portfolio) || portfolio.length === 0) {
      return { success: false, error: '缺少有效的 portfolio 数据' }
    }

    const apiKey = body.apiKey || process.env.DEEPSEEK_API_KEY || ''

    if (!apiKey) {
      console.warn('[diagnose.post] 未配置 DEEPSEEK_API_KEY，返回兜底分析')
      return {
        success: true,
        data: {
          ...FALLBACK_RESULT,
          concentration: '未配置 DeepSeek API Key。请在环境变量中设置 DEEPSEEK_API_KEY 或在请求中传入 apiKey 参数。\n\n' + FALLBACK_RESULT.concentration,
        },
      }
    }

    // 构建持仓摘要文本
    const portfolioSummary = portfolio
      .map((h: any, i: number) => {
        const name = h.name || h.ts_code || '未知'
        const industry = h.industry || '未知行业'
        const cost = Number(h.cost) || 0
        const close = Number(h.close) || 0
        const shares = Number(h.shares) || 0
        const pctChg = Number(h.pct_chg) || 0
        const pe = h.pe ? h.pe.toFixed(2) : 'N/A'
        const pb = h.pb ? h.pb.toFixed(2) : 'N/A'
        const profitPct = cost > 0 ? (((close - cost) / cost) * 100).toFixed(2) : '0'
        return `${i + 1}. ${name}（${h.ts_code}）
   - 行业: ${industry}
   - 成本: ${cost.toFixed(2)}，当前价: ${close.toFixed(2)}
   - 持仓盈亏: ${profitPct}%
   - 今日涨跌: ${pctChg.toFixed(2)}%
   - PE: ${pe}，PB: ${pb}`
      })
      .join('\n\n')

    const systemPrompt = `你是一位专业的投资组合分析师，擅长评估投资组合的风险收益特征。请根据用户提供的持仓数据，给出以下五个维度的详细分析：

1. **持仓集中度分析**：评估行业集中度、个股集中度，指出过度集中的风险
2. **相关性分析**：分析各持仓之间的潜在相关性，是否存在同涨同跌风险
3. **估值分析**：基于 PE、PB 等指标评估当前持仓的整体估值水平
4. **优化建议**：给出具体的调仓和优化建议
5. **风险提示**：基于当前市场环境和持仓特征，提示主要风险点

请用中文回答，格式清晰，每个维度用标题分隔。分析要具体、有数据支撑。最后请注明"以上分析仅供参考，不构成投资建议"。`

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: '系统', content: systemPrompt },
          { role: 'user', content: `请分析以下投资组合：\n\n${portfolioSummary}` },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error(`[diagnose.post] DeepSeek API 错误 ${response.status}:`, errorText)
      return {
        success: true,
        data: {
          ...FALLBACK_RESULT,
          concentration: `AI 分析接口返回错误（${response.status}），请稍后重试。\n\n` + FALLBACK_RESULT.concentration,
        },
      }
    }

    const json = await response.json()
    const aiContent = json.choices?.[0]?.message?.content || ''

    if (!aiContent) {
      return {
        success: true,
        data: {
          ...FALLBACK_RESULT,
          concentration: 'AI 未返回有效内容，请稍后重试。\n\n' + FALLBACK_RESULT.concentration,
        },
      }
    }

    // 将 AI 返回的整体文本按维度粗略拆分
    // 简单策略：如果 AI 返回格式规范，尝试提取各维度；否则整体放 diagnosis 字段
    function extractSection(text: string, keyword: string): string {
      const lines = text.split('\n')
      let start = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(keyword)) {
          start = i + 1
        } else if (start >= 0 && (lines[i].includes('**') || lines[i].includes('分析') || lines[i].includes('##'))) {
          // 遇到下一个标题就停止
          break
        }
      }
      if (start < 0) return text
      // 收集从 start 到下一个标题之间的内容
      const collected: string[] = []
      for (let i = start; i < lines.length; i++) {
        const trimmed = lines[i].trim()
        if (trimmed && (
          trimmed.startsWith('**') ||
          trimmed.startsWith('##') ||
          /^\d+\.\s*(\*\*)?(分析|建议|风险|提示|估值|相关|集中)/.test(trimmed)
        )) {
          break
        }
        collected.push(lines[i])
      }
      return collected.join('\n').trim() || text
    }

    return {
      success: true,
      data: {
        concentration: extractSection(aiContent, '集中度'),
        correlation: extractSection(aiContent, '相关'),
        valuation: extractSection(aiContent, '估值'),
        suggestions: extractSection(aiContent, '建议'),
        risk: extractSection(aiContent, '风险'),
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    console.error('[diagnose.post] Error:', error)
    return {
      success: true,
      data: {
        ...FALLBACK_RESULT,
        concentration: `分析异常：${error.message || '未知错误'}。\n\n` + FALLBACK_RESULT.concentration,
      },
      error: error.message,
    }
  }
})
