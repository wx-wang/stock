/**
 * POST /api/holdings/save — 保存持仓到持久化目录
 * 数据路径独立于项目代码，代码修改/调试不影响用户数据
 */
import { promises as fs } from 'fs'
import path from 'path'

const PERSIST_DIR = path.resolve('/sessions/6a1d476cb705a1c7ea935295/persist')
const DATA_FILE = path.join(PERSIST_DIR, 'holdings.json')

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    await fs.mkdir(PERSIST_DIR, { recursive: true })
    await fs.writeFile(DATA_FILE, JSON.stringify(body, null, 2), 'utf-8')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})
