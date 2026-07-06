/**
 * server/lib/tushare.ts — 向后兼容重导出
 *
 * 本文件保留以兼容旧的 import '@/server/lib/tushare' 引用。
 * 实际逻辑已迁移到 server/adapters/tushare.ts。
 */

export {
  callTushare,
  getStockBasic,
  getDaily,
  getDailyBatch,
  getDailyBasic,
  getDailyBasicAll,
  getIndexDaily,
  getBondYield,
  getIncome,
  getCashflow,
  getBalancesheet,
  getIndexClassify,
  getSwDaily,
  getSwDailyBatch,
  getBrokerRecommend,
  getIndexMember,
  getIdxFactorPro,
} from '../adapters/tushare'
