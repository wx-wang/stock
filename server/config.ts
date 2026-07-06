/**
 * config.ts — 全局配置单一入口
 *
 * 所有外部 API 的凭据、端点统一在此定义。
 * 优先级：环境变量 > 默认值（开发用）
 *
 * 替换方法：
 *   - 换 Tushare token  → 改 TUSHARE_TOKEN
 *   - 换 DeepSeek key   → 改 DEEPSEEK_API_KEY
 *   - 换代理地址       → 改 TUSHARE_URL
 *
 * Tushare token 更新方法（3 步）：
 *   1. 改本文件 TUSHARE_TOKEN 默认值
 *   2. 同步改 .env.example
 *   3. 云端执行：
 *      echo 'TUSHARE_TOKEN=新token' > /home/stock/.env
 *      echo 'TUSHARE_URL=http://lianghua.nanyangqiankun.top' >> /home/stock/.env
 *      pm2 restart stock
 */

export const TUSHARE_URL = process.env.TUSHARE_URL || 'http://lianghua.nanyangqiankun.top'
export const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || '158637460d4519a4f1a8d8b49ed991feabfdcd3b55a1cc41631c54ea19ce'

export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '你的DeepSeek_API_Key'
export const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

export const INVESTO_KEY = process.env.INVESTO_KEY || '你的Investoday_key'
export const INVESTO_BASE = process.env.INVESTO_BASE || 'https://data-api.investoday.net/data'

export const EASTMONEY_URL = process.env.EASTMONEY_URL || 'https://datacenter-web.eastmoney.com/api/data/v1/get'

/** 数据持久化根目录（部署时通过环境变量 PERSIST_DIR 覆盖） */
export const PERSIST_DIR = process.env.PERSIST_DIR || './persist'
