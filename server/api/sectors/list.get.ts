/**
 * GET /api/sectors/list
 * 获取申万二级行业列表
 */
import { getIndexClassify } from '@/server/lib/tushare'

export default defineEventHandler(async () => {
  try {
    const sectors = await getIndexClassify('L2', 'SW2021')
    
    // 格式化返回数据
    const formatted = sectors.map((s: any) => ({
      index_code: s.index_code,
      industry_name: s.industry_name,
      industry_code: s.industry_code,
      level: s.level,
      is_pub: s.is_pub,
      parent_code: s.parent_code,
      src: s.src,
    }))

    return {
      success: true,
      data: {
        count: formatted.length,
        sectors: formatted,
      },
    }
  } catch (e: any) {
    console.error('[sectors/list]', e)
    return { success: false, error: e.message }
  }
})
