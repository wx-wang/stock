/**
 * 投资组合计算工具函数
 */

import type { PortfolioSummary, StockQuote, Holding } from '@/types'

/**
 * 计算两个数组的 Pearson 相关系数
 *
 * @param x - 第一个数值数组
 * @param y - 第二个数值数组（长度必须与 x 相同）
 * @returns Pearson 相关系数，范围 [-1, 1]；若无法计算则返回 0
 */
export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3 || n !== y.length) return 0

  // 计算均值
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += x[i]
    sumY += y[i]
  }
  const meanX = sumX / n
  const meanY = sumY / n

  // 计算协方差与方差
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }

  if (varX === 0 || varY === 0) return 0

  return cov / Math.sqrt(varX * varY)
}

/**
 * 计算投资组合汇总指标
 *
 * @param holdings - 持仓列表
 * @param quotes  - 对应的行情数据（需与 holdings 按 ts_code 对应）
 * @returns PortfolioSummary
 */
export function calculatePortfolioSummary(
  holdings: Array<{ ts_code: string; cost: number; shares: number; close?: number; change?: number; pct_chg?: number; market_value?: number; cost_value?: number; profit?: number; today_profit?: number }>,
  quotes?: Array<{ ts_code: string; close: number; change?: number; pct_chg?: number }>
): PortfolioSummary {
  const quoteMap = new Map<string, { close: number; change?: number; pct_chg?: number }>()
  if (quotes) {
    quotes.forEach((q) => quoteMap.set(q.ts_code, q))
  }

  let totalMarketValue = 0
  let totalCost = 0
  let todayProfit = 0

  for (const h of holdings) {
    const q = quoteMap.get(h.ts_code)
    const close = q?.close || h.close || 0
    const change = q?.change ?? h.change ?? 0
    const shares = h.shares || 0
    const cost = h.cost || 0

    totalMarketValue += close * shares
    totalCost += cost * shares
    todayProfit += change * shares
  }

  const totalProfit = totalMarketValue - totalCost
  const totalProfitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0
  const todayProfitPct = totalMarketValue > 0 ? (todayProfit / (totalMarketValue - todayProfit)) * 100 : 0

  return {
    totalMarketValue,
    totalCost,
    totalProfit,
    totalProfitPct,
    todayProfit,
    todayProfitPct,
  }
}

/**
 * 格式化金额
 *
 * @param n - 数值
 * @param decimals - 小数位数，默认 2
 * @returns 格式化后的金额字符串，如 "12,345.68"
 */
export function formatMoney(n: number, decimals: number = 2): string {
  if (isNaN(n) || !isFinite(n)) return '--'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const parts = abs.toFixed(decimals).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return sign + parts.join('.')
}

/**
 * 格式化百分比
 *
 * @param n - 数值（如 5.23 表示 5.23%）
 * @param decimals - 小数位数，默认 2
 * @returns 格式化后的百分比字符串，如 "+5.23%" 或 "-2.10%"
 */
export function formatPercent(n: number, decimals: number = 2): string {
  if (isNaN(n) || !isFinite(n)) return '--'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(decimals)}%`
}
