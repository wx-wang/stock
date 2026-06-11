/**
 * adapters/deepseek.ts — DeepSeek LLM 适配器
 *
 * 统一封装 DeepSeek 大模型调用，使用原生 fetch。
 */

import { DEEPSEEK_API_KEY, DEEPSEEK_API_URL, DEEPSEEK_MODEL } from '../config'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 发送对话请求，返回模型回复文本
 */
export async function chat(messages: ChatMessage[], temperature = 0.7): Promise<string> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 120_000)

  try {
    const resp = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature }),
      signal: ctrl.signal,
    } as any)
    const json = await resp.json()
    if (ctrl.signal.aborted) return ''
    return json.choices?.[0]?.message?.content || ''
  } catch {
    return ''
  } finally {
    clearTimeout(to)
  }
}
