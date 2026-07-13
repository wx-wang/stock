import { listIndustryReports } from '@/server/services/industry-reports'

export default defineEventHandler(async () => {
  try {
    const reports = await listIndustryReports()
    return {
      success: true,
      reports,
      total: reports.length,
    }
  } catch (e: any) {
    console.error('[industry-reports/list]', e.message)
    return { success: false, reports: [], total: 0, error: e.message }
  }
})
