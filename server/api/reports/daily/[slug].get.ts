import { getDailyAnalysis } from '@/server/services/daily-analysis'

export default defineEventHandler(async (event) => {
  try {
    const slug = getRouterParam(event, 'slug') || ''
    const report = await getDailyAnalysis(slug)
    if (!report) {
      setResponseStatus(event, 404)
      return { success: false, error: '分析不存在' }
    }

    return {
      success: true,
      report,
    }
  } catch (e: any) {
    console.error('[daily-analysis/detail]', e.message)
    return { success: false, error: e.message }
  }
})
