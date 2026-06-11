/**
 * DELETE /api/watchlist?ts_code=XXX — 删除自选股
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const PERSIST_DIR = path.resolve('/sessions/6a1d476cb705a1c7ea935295/persist')
const DATA_FILE = path.join(PERSIST_DIR, 'watchlist.json')

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const tsCode = q.ts_code as string
  if (!tsCode) return { success: false, error: '缺少 ts_code' }

  let wl: any = { stocks: [] }
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    wl = JSON.parse(raw)
  } catch {}
  if (!wl.stocks) wl.stocks = []
  wl.stocks = wl.stocks.filter((s: any) => s.ts_code !== tsCode)
  await fs.writeFile(DATA_FILE, JSON.stringify(wl, null, 2), 'utf-8')
  return { success: true }
})
