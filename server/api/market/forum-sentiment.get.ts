/**
 * GET /api/market/forum-sentiment — 论坛舆情数据
 * 读取持久化的 forum-radar/latest.json（由 forum_crawler.py 写入）
 * 兼容旧版 persist/forum-data.json。
 */
import { promises as fs } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { PERSIST_DIR } from '../../config'

const RADAR_FILE = path.join(PERSIST_DIR, 'forum-radar/latest.json')
const LEGACY_FILE = path.join(PERSIST_DIR, 'forum-data.json')
const SCRIPT_FILE = path.resolve(process.cwd(), 'scripts/forum_crawler.py')

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return null
  }
}

async function runCrawler(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', [SCRIPT_FILE], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `forum crawler exited with code ${code}`))
    })
  })
}

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (query.refresh === '1') {
      const key = process.env.FORUM_REFRESH_KEY || ''
      if (!key || query.key !== key) {
        setResponseStatus(event, 403)
        return { success: false, message: 'refresh disabled' }
      }
      await runCrawler()
    }

    const data = await readJson(RADAR_FILE) || await readJson(LEGACY_FILE)
    if (!data) throw new Error('missing forum radar cache')

    return { success: true, ...data }
  } catch (e: any) {
    return {
      success: false,
      message: '暂无舆情数据，请先在服务器运行 python3 scripts/forum_crawler.py',
      error: e.message,
    }
  }
})
