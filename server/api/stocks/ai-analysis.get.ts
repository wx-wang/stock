/**
 * GET /api/stocks/ai-analysis?ts_code=XXX → 读取缓存
 */
import { promises as fs } from 'fs'
import path from 'path'

const PERSIST_DIR = path.resolve('/sessions/6a1d476cb705a1c7ea935295/persist')

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const tsCode = (q.ts_code as string) || ''
  if (!tsCode) return { success: false, error: '缺少 ts_code' }

  try {
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    const raw = await fs.readFile(path.join(PERSIST_DIR, `ai-${tsCode.replace('.', '_')}.json`), 'utf-8')
    const data = JSON.parse(raw)
    return { success: true, data: { analysis: data.analysis, summary: data.summary || '', date: data.date } }
  } catch {
    return { success: true, data: null }
  }
})
