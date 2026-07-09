/**
 * GET /api/market/forum-sentiment — 论坛舆情数据
 * 读取持久化的 forum-data.json（由 forum_crawler.py 写入）
 */
import { promises as fs } from 'fs'
import path from 'path'
import { PERSIST_DIR } from '../../config'

const DATA_FILE = path.join(PERSIST_DIR, 'forum-data.json')

export default defineEventHandler(async () => {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return { success: true, ...data }
  } catch {
    return {
      success: false,
      message: '暂无舆情数据，请先在服务器运行 python3 scripts/forum_crawler.py',
    }
  }
})
