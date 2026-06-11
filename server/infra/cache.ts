/**
 * infra/cache.ts — 磁盘缓存工具
 *
 * 提供统一的 JSON 文件读写缓存，供所有 API 使用。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PERSIST_DIR } from '../config'

/** 初始化 persist 目录 */
export async function ensurePersistDir(): Promise<void> {
  await fs.mkdir(PERSIST_DIR, { recursive: true })
}

/** 读取缓存 JSON 文件，不存在返回 null */
export async function readCache<T = any>(filename: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(PERSIST_DIR, filename), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 写入缓存 JSON 文件 */
export async function writeCache(filename: string, data: any): Promise<void> {
  await ensurePersistDir()
  await fs.writeFile(path.join(PERSIST_DIR, filename), JSON.stringify(data, null, 2), 'utf-8')
}
