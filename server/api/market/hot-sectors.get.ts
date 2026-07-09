/**
 * GET /api/market/hot-sectors — 今日热门行业 Top 10 + 概念 Top 10
 * 数据源：同花顺 ths_index (分类) + ths_daily (行情)
 * 缓存：30 分钟磁盘
 */
import { getThsDailyBatch, getThsIndex } from '@/server/adapters/tushare'
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const CACHE_FILE = path.join(PERSIST_DIR, 'market-hot-sectors.json')
const CACHE_TTL = 30 * 60 * 1000

interface SectorItem {
  code: string; name: string; pctChg: number; close: number; vol: number; totalMv: number
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
    const d1 = new Date(now); d1.setDate(d1.getDate() - 1)
    const yesterday = `${d1.getFullYear()}${String(d1.getMonth()+1).padStart(2,'0')}${String(d1.getDate()).padStart(2,'0')}`

    // 取概念和行业列表
    const [conceptIdx, industryIdx] = await Promise.all([
      getThsIndex('N'),
      getThsIndex('I'),
    ])

    // 批量拉行情（先试今天，不行用昨天）
    let conceptCodes = conceptIdx.map((r: any) => r.ts_code)
    let industryCodes = industryIdx.map((r: any) => r.ts_code)

    // 取行情
    let conceptMap = await getThsDailyBatch(conceptCodes, today)
    let industryMap = await getThsDailyBatch(industryCodes, today)
    if (conceptMap.size < 10) {
      conceptMap = await getThsDailyBatch(conceptCodes, yesterday)
      industryMap = await getThsDailyBatch(industryCodes, yesterday)
    }

    // 构建名称映射
    const nameMap = new Map<string, string>()
    for (const r of conceptIdx) nameMap.set(r.ts_code, r.name)
    for (const r of industryIdx) nameMap.set(r.ts_code, r.name)

    function top(items: Map<string, any>, n: number): SectorItem[] {
      const arr: SectorItem[] = []
      for (const [code, row] of items) {
        arr.push({
          code,
          name: nameMap.get(code) || code,
          pctChg: Number(row.pct_change) || 0,
          close: Number(row.close) || 0,
          vol: Number(row.vol) || 0,
          totalMv: Number(row.total_mv) || 0,
        })
      }
      return arr.sort((a, b) => b.pctChg - a.pctChg).slice(0, n)
    }

    const result = {
      success: true,
      industries: top(industryMap, 10),
      concepts: top(conceptMap, 10),
      _ts: Date.now(),
    }
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {})
    await fs.writeFile(CACHE_FILE, JSON.stringify(result)).catch(() => {})
    return result
  } catch (e: any) {
    return { success: false, industries: [], concepts: [], error: e.message }
  }
})
