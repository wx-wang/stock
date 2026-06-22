/**
 * infra/http.ts — 统一 HTTP 客户端
 *
 * POST → curl（Tushare 代理兼容性要求，fetch 的 keep-alive 会截断响应）
 * GET  → Node 22 原生 fetch（快，零 shell 开销）
 */
import { exec } from 'node:child_process'

/** GET 请求 */
export async function httpGet(url: string, timeoutSec = 30): Promise<string> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutSec * 1000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': 'https://www.baidu.com/' } } as any)
    return await resp.text()
  } catch {
    return ''
  }
}

/**
 * POST 请求（JSON body）— 异步 curl，不阻塞事件循环
 *
 * 为什么用 curl 而不是 fetch：Tushare 代理服务器对 HTTP keep-alive
 * 处理有 bug，fetch 的持久连接会导致响应体被截断。curl 默认
 * Connection: close，每次请求独立 TCP 连接，兼容代理。
 */
export async function httpPost(url: string, body: Record<string, any>, timeoutSec = 60): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(
      `curl -s --connect-timeout 8 --max-time ${timeoutSec} -X POST -H 'Content-Type: application/json' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}' '${url}'`,
      { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024, timeout: (timeoutSec + 10) * 1000 },
      (err, stdout) => {
        if (err) {
          // code 28 = curl timeout; 其他 = 网络/代理错误
          if ((err as any).code === 28 || (err as any).killed) {
            console.error(`[httpPost] timeout: ${body.api_name || '?'} after ${timeoutSec}s`)
          }
          resolve('')
          return
        }
        resolve((stdout || '').trim())
      },
    )

    // 兜底保护：如果 Node 的 timeout 也没杀掉进程，手动 kill
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
        resolve('')
      }
    }, (timeoutSec + 15) * 1000)

    // 正常结束时清理定时器
    child.on('close', () => clearTimeout(killTimer))
  })
}

/** 带 JSON 解析的 GET */
export async function httpGetJson(url: string, timeoutSec?: number): Promise<any> {
  const raw = await httpGet(url, timeoutSec)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** 带 JSON 解析的 POST */
export async function httpPostJson(url: string, body: Record<string, any>, timeoutSec?: number): Promise<any> {
  const raw = await httpPost(url, body, timeoutSec)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
