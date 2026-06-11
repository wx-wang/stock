/**
 * GET /api/screener/overview — 全量A股一览表（按 SW L3 行业分组）
 *
 * 架构：config → adapters(eastmoney+tushare) → services(screener+dcf) → 本病路由（薄）
 *
 * ?refresh=true  强制刷新
 */
import { buildScreener, readScreenerCache, clearScreenerCache } from '../../services/screener'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const refresh = q.refresh === 'true' || q.refresh === '1'

  if (!refresh) {
    const cached = await readScreenerCache()
    if (cached) return cached
  }

  // 清缓存 + 全量重建
  await clearScreenerCache()
  return buildScreener()
})
