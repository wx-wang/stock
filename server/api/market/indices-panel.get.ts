/**
 * GET /api/market/indices-panel — 6 大指数实时行情
 * 缓存：5 分钟磁盘
 */
import { getIndexDaily } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-indices.json')
const CACHE_TTL = 5 * 60 * 1000

const INDICES: Array<{ code: string; name: string }> = [
  { code: '000001.SH', name: '上证指数' },
  { code: '399001.SZ', name: '深证成指' },
  { code: '399006.SZ', name: '创业板指' },
  { code: '000688.SH', name: '科创50' },
  { code: '000300.SH', name: '沪深300' },
  { code: '000905.SH', name: '中证500' },
]

export default defineEventHandler(async () => {
  try {
    const cached = await fs.readFile(CACHE_FILE, 'utf-8').catch(() => null)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c._ts < CACHE_TTL) return { success: true, indices: c.indices }
    }

    const today = new Date()
    const endStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
    const start = new Date(today); start.setDate(start.getDate() - 5)
    const startStr = `${start.getFullYear()}${String(start.getMonth()+1).padStart(2,'0')}${String(start.getDate()).padStart(2,'0')}`

    const results: any[] = []
    for (const idx of INDICES) {
      const items = await getIndexDaily(idx.code, startStr, endStr)
      const latest = items[items.length - 1]
      const prev = items[items.length - 2]
      if (latest) {
        results.push({
          code: idx.code,
          name: idx.name,
          close: Number(latest.close) || 0,
          open: Number(latest.open) || 0,
          high: Number(latest.high) || 0,
          low: Number(latest.low) || 0,
          pctChg: Number(latest.pct_chg) || 0,
          amount: Number(latest.amount) || 0,
          vol: Number(latest.vol) || 0,
          preClose: prev ? Number(prev.close) || 0 : 0,
        })
      }
    }

    const payload = { indices: results, _ts: Date.now() }
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload)).catch(() => {})
    return { success: true, indices: results }
  } catch (e: any) {
    return { success: false, indices: [], error: e.message }
  }
})
