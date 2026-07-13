/**
 * config.ts — 全局配置单一入口
 *
 * 所有外部 API 的凭据、端点统一在此定义。
 * 优先级：环境变量 > 空值。
 *
 * 替换方法：
 *   - 换 Tushare token  → 改 TUSHARE_TOKEN
 *   - 换 DeepSeek key   → 改 DEEPSEEK_API_KEY
 *   - 换代理地址       → 改 TUSHARE_URL
 *
 * Tushare token 更新方法：只修改服务器上的 .env，不修改代码。
 * 具体命令见 DEPLOY.md。
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return

  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (!key || process.env[key] !== undefined) continue

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadLocalEnv()

export const TUSHARE_URL = process.env.TUSHARE_URL || ''
export const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || ''

console.log(
  `[config] cwd=${process.cwd()} TUSHARE_URL=${TUSHARE_URL ? 'set' : 'missing'} TUSHARE_TOKEN_LEN=${TUSHARE_TOKEN.length}`,
)

export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '你的DeepSeek_API_Key'
export const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

export const INVESTO_KEY = process.env.INVESTO_KEY || '你的Investoday_key'
export const INVESTO_BASE = process.env.INVESTO_BASE || 'https://data-api.investoday.net/data'

export const EASTMONEY_URL = process.env.EASTMONEY_URL || 'https://datacenter-web.eastmoney.com/api/data/v1/get'

/** 数据持久化根目录（部署时通过环境变量 PERSIST_DIR 覆盖） */
export const PERSIST_DIR = process.env.PERSIST_DIR || './persist'
