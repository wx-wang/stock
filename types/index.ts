/**
 * 股票看板项目 - TypeScript 类型定义
 */

export interface Holding {
  id: string
  ts_code: string
  name: string
  cost: number
  shares: number
  buy_date: string
  industry?: string
}

export interface StockQuote {
  ts_code: string
  name: string
  close: number
  pre_close: number
  change: number
  pct_chg: number
  vol: number
  amount: number
  pe?: number
  pb?: number
  industry?: string
}

export interface PortfolioSummary {
  totalMarketValue: number
  totalCost: number
  totalProfit: number
  totalProfitPct: number
  todayProfit: number
  todayProfitPct: number
}

export interface CorrelationItem {
  code1: string
  code2: string
  name1: string
  name2: string
  correlation: number
}

export interface AiDiagnosisResult {
  concentration: string
  correlation: string
  valuation: string
  suggestions: string
  risk: string
  timestamp: string
}
