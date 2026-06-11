/**
 * adapters/eastmoney.ts — 东方财富数据源适配器
 *
 * 封装分析师预测数据（EPS/评级/目标价）的拉取逻辑，
 * 包括分页、去重、北交所过滤。
 */

import { EASTMONEY_URL } from '../config'
import { httpGetJson } from '../infra/http'

const PAGES = 6
const PAGE_SIZE = 500

const EM_COLUMNS = [
  'SECURITY_CODE', 'SECURITY_NAME_ABBR', 'INDUSTRY_BOARD',
  'RATING_ORG_NUM', 'EPS1', 'EPS2', 'EPS3', 'EPS4',
  'YEAR1', 'YEAR2', 'YEAR3', 'YEAR4',
  'RATING_BUY_NUM', 'RATING_ADD_NUM',
  'DEC_AIMPRICEMAX',
].join(',')

// 北交所代码前缀（920 / 83 / 87 / 88）
const BSE_PREFIXES = ['92', '83', '87', '88']

function isBSE(code: string): boolean {
  return BSE_PREFIXES.some(p => code.startsWith(p))
}

/** 拉取全量分析师预测数据（已去重 + 过滤北交所） */
export interface AnalystStock {
  SECURITY_CODE: string
  SECURITY_NAME_ABBR: string
  INDUSTRY_BOARD: string
  RATING_ORG_NUM: number
  EPS1: number | string; EPS2: number | string; EPS3: number | string; EPS4: number | string
  YEAR1: number; YEAR2: number; YEAR3: number; YEAR4: number
  RATING_BUY_NUM: number; RATING_ADD_NUM: number
  DEC_AIMPRICEMAX: number
}

export async function fetchAnalystForecasts(): Promise<AnalystStock[]> {
  const raw: any[] = []
  for (let page = 1; page <= PAGES; page++) {
    const params = new URLSearchParams({
      reportName: 'RPT_WEB_RESPREDICT',
      columns: EM_COLUMNS,
      pageNumber: String(page),
      pageSize: String(PAGE_SIZE),
      sortTypes: '-1',
      sortColumns: 'RATING_ORG_NUM',
    })
    try {
      const d = await httpGetJson(EASTMONEY_URL + '?' + params.toString())
      if (d && d.success && d.result?.data) raw.push(...d.result.data)
    } catch (e: any) {
      console.error(`[eastmoney] page ${page} failed:`, e.message)
    }
  }

  // 去重（东方财富分页不稳定）
  const seen = new Set<string>()
  const deduped: AnalystStock[] = []
  for (const s of raw) {
    if (!seen.has(s.SECURITY_CODE)) {
      seen.add(s.SECURITY_CODE)
      if (!isBSE(s.SECURITY_CODE)) deduped.push(s)
    }
  }

  console.log(`[eastmoney] raw=${raw.length} deduped=${deduped.length}`)
  return deduped
}
