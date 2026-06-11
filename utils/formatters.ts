/**
 * Format a number as money with thousands separators.
 * @example formatMoney(12345.67) → "12,345.67"
 */
export function formatMoney(value: number, decimals: number = 2): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format a large number into compact Chinese unit representation.
 * @example formatLargeMoney(12345) → "1.23万"
 * @example formatLargeMoney(123456789) → "1.23亿"
 */
export function formatLargeMoney(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs >= 1e8) {
    return `${sign}${(abs / 1e8).toFixed(2)}亿`
  }
  if (abs >= 1e4) {
    return `${sign}${(abs / 1e4).toFixed(2)}万`
  }
  return `${sign}${abs.toFixed(2)}`
}

/**
 * Format a number as a percentage with sign prefix.
 * @example formatPercent(3.567, 2) → "+3.57%"
 * @example formatPercent(-1.2, 2) → "-1.20%"
 */
export function formatPercent(value: number, decimals: number = 2): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

/**
 * Format a rate-of-change value as percentage string (alias of formatPercent).
 * @example formatChange(3.567) → "+3.57%"
 * @example formatChange(-1.2) → "-1.20%"
 */
export function formatChange(value: number, decimals: number = 2): string {
  return formatPercent(value, decimals)
}

/**
 * Return a CSS color string based on the sign of the value.
 * positive → '#E15241' (red/up), negative → '#22AB94' (green/down), zero → '#8B8FA3'
 */
export function getChangeColor(value: number): string {
  if (value > 0) return '#E15241'
  if (value < 0) return '#22AB94'
  return '#8B8FA3'
}

/**
 * Return a CSS class name based on the sign of the value.
 * positive → 'up', negative → 'down', zero → ''
 */
export function getChangeClass(value: number): string {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return ''
}
