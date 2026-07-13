import { getIndustryReport } from '@/server/services/industry-reports'

export default defineEventHandler(async (event) => {
  try {
    const slug = getRouterParam(event, 'slug') || ''
    const report = await getIndustryReport(slug)
    if (!report) {
      setResponseStatus(event, 404)
      return { success: false, error: '报告不存在' }
    }

    return {
      success: true,
      report,
    }
  } catch (e: any) {
    console.error('[industry-reports/detail]', e.message)
    return { success: false, error: e.message }
  }
})
