import { listDailyAnalyses } from '@/server/services/daily-analysis'

export default defineEventHandler(async () => {
  try {
    const reports = await listDailyAnalyses()
    return {
      success: true,
      reports,
      total: reports.length,
    }
  } catch (e: any) {
    console.error('[daily-analysis/list]', e.message)
    return { success: false, reports: [], total: 0, error: e.message }
  }
})
