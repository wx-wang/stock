/**
 * GET /api/holdings/load — 从持久化目录读取持仓
 * 数据路径独立于项目代码，代码修改/调试不影响用户数据
 */
import { promises as fs } from 'fs'
import path from 'path'

// ★ 持久化目录——与项目代码分离，任何代码操作不会触碰此文件
import { PERSIST_DIR } from '../../config'
const DATA_FILE = path.join(PERSIST_DIR, 'holdings.json')

export default defineEventHandler(async () => {
  try {
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    const raw = await fs.readFile(DATA_FILE, 'utf-8').catch(() => '{"holdings":[]}')
    return JSON.parse(raw)
  } catch {
    return { holdings: [] }
  }
})
