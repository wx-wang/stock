/**
 * GET /api/portfolio/correlation
 * 计算股票之间的日收益率 Pearson 相关系数矩阵
 *
 * Query 参数：
 *   ts_codes - 逗号分隔的股票代码
 *   names    - 逗号分隔的股票名称（与 ts_codes 顺序对应）
 *   days     - 回溯天数，默认 500
 */
import { getDaily, getStockBasic } from '@/server/lib/tushare'

function formatDate(date: Date): string {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const tsCodesRaw = (query.ts_codes as string) || ''
    const namesRaw = (query.names as string) || ''
    const days = Math.max(30, parseInt((query.days as string) || '500', 10))

    if (!tsCodesRaw) return { success: false, error: '缺少 ts_codes 参数', data: [] }

    const tsCodes = tsCodesRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (tsCodes.length < 2) return { success: false, error: '至少需要 2 只股票', data: [] }

    // 名称：优先取 query 传入的，否则从 StockBasic 获取
    const givenNames = namesRaw ? namesRaw.split(',').map(s => s.trim()) : []
    const nameMap = new Map<string, string>()
    if (givenNames.length === tsCodes.length) {
      for (let i = 0; i < tsCodes.length; i++) nameMap.set(tsCodes[i], givenNames[i])
    } else {
      try {
        const basics = await getStockBasic()
        for (const b of basics) nameMap.set(b.ts_code || '', b.name || '')
      } catch { /* fallback to code */ }
    }

    const endDate = formatDate(new Date())
    const startDateObj = new Date(); startDateObj.setDate(startDateObj.getDate() - days)
    const startDate = formatDate(startDateObj)

    // 并行拉取所有股票日线
    const dailyLists = await Promise.all(tsCodes.map(c => getDaily(c, startDate, endDate)))

    // 构建 ts_code → Map<日期, 日收益率(小数)>
    const retMaps: Map<string, number>[] = dailyLists.map(list => {
      const m = new Map<string, number>()
      for (const item of list) {
        const d = item.trade_date as string
        const v = Number(item.pct_chg)
        if (!isNaN(v)) m.set(d, v / 100)
      }
      return m
    })

    // ★ 核心修复：取所有股票都有数据的公共日期（严格交集）
    const dateSets = retMaps.map(m => new Set(m.keys()))
    let intersection = dateSets[0]
    for (let i = 1; i < dateSets.length; i++) {
      intersection = new Set([...intersection].filter(d => dateSets[i].has(d)))
    }
    const commonDates = Array.from(intersection).sort()
    const n = commonDates.length

    if (n < 20) {
      return {
        success: false,
        error: `公共有效交易日不足（共 ${n} 天，最少需要 20 天），请减少股票数量或扩大时间范围`,
        data: { ts_codes: tsCodes, days, valid_points: n, matrix: [] },
      }
    }

    // ★ 严格按公共日期对齐，构建收益率矩阵 [tsCode_idx][date_idx]
    const aligned: number[][] = []
    for (let i = 0; i < tsCodes.length; i++) {
      const rm = retMaps[i]
      aligned.push(commonDates.map(d => rm.get(d)!))
    }

    // 两两 Pearson
    const matrix: Array<{ code1: string; code2: string; name1: string; name2: string; correlation: number }> = []
    for (let i = 0; i < tsCodes.length; i++) {
      for (let j = i + 1; j < tsCodes.length; j++) {
        const corr = pearson(aligned[i], aligned[j])
        matrix.push({
          code1: tsCodes[i], code2: tsCodes[j],
          name1: nameMap.get(tsCodes[i]) || tsCodes[i],
          name2: nameMap.get(tsCodes[j]) || tsCodes[j],
          correlation: Math.round(corr * 10000) / 10000,
        })
      }
    }

    return { success: true, data: { ts_codes: tsCodes, days, valid_points: n, matrix } }
  } catch (error: any) {
    console.error('[correlation] Error:', error)
    return { success: false, error: error.message || '计算失败', data: [] }
  }
})

function pearson(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return 0
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i]
    sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]
  }
  const num = n * sxy - sx * sy
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
  return den === 0 ? 0 : num / den
}
