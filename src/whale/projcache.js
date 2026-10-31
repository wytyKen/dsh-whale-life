// projcache 轮询：读 DSH 会话的 session_projcache JSON，等一轮"提示→回复"完成。
// responder（聊天管线）与 wake（行动管线）共用同一判定：openStep 为 null 且轮次数增加。

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PROJCACHE_DIR = path.join(PLUGIN_ROOT, 'dsh-home', 'storages', 'session_projcache', 'sessions')

/** 读取会话统计与轮次大纲；文件未生成时返回 null */
export async function getProjcacheStats(sessionId, dir = PROJCACHE_DIR) {
  try {
    const data = JSON.parse(await readFile(path.join(dir, `${sessionId}.json`), 'utf8'))
    return {
      stats: data?.record?.rows?.sessionStats?.val ?? null,
      outline: data?.record?.rows?.turnOutline?.val ?? null,
    }
  } catch {
    return null
  }
}

/**
 * 等待指定会话产生新的一轮回复。
 * @returns {Promise<string|null>} 回复文本；超时/无回复返回 null
 */
export function waitTurnComplete(sessionId, baselineTurns, { timeoutMs = 180_000, intervalMs = 2000, onPoll } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = setInterval(async () => {
      try {
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          return resolve(null)
        }
        const data = await getProjcacheStats(sessionId)
        const { turns, openStep } = data?.stats ?? {}
        onPoll?.({ turns, openStep })
        if (openStep !== null && openStep !== undefined) return // 还在思考
        if (!Number.isFinite(turns) || turns <= baselineTurns) return // 没有新回复
        const lastTurn = data.outline?.turns?.[turns - 1]
        clearInterval(timer)
        resolve(typeof lastTurn?.response === 'string' ? lastTurn.response.trim() : null)
      } catch { /* 轮询出错继续等 */ }
    }, intervalMs)
    if (timer.unref) timer.unref()
  })
}
