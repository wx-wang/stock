/**
 * POST /api/watchlist — 添加自选股
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const PERSIST_DIR = path.resolve('/sessions/6a1d476cb705a1c7ea935295/persist')
const DATA_FILE = path.join(PERSIST_DIR, 'watchlist.json')

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const tsCode = body.ts_code as string
  const name = body.name as string
  const selectedDate = (body.selected_date as string) || ''
  if (!tsCode) return { success: false, error: '缺少 ts_code' }

  await fs.mkdir(PERSIST_DIR, { recursive: true })
  let wl: any = { stocks: [] }
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    wl = JSON.parse(raw)
  } catch {}
  if (!wl.stocks) wl.stocks = []
  if (wl.stocks.some((s: any) => s.ts_code === tsCode)) return { success: false, error: '已存在' }
  wl.stocks.push({ id: `w_${Date.now()}`, ts_code: tsCode, name, selected_date: selectedDate, added_at: new Date().toISOString() })
  await fs.writeFile(DATA_FILE, JSON.stringify(wl, null, 2), 'utf-8')
  return { success: true }
})
