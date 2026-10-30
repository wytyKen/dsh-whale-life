// OneBot HTTP API 客户端：发送/查询统一走 HTTP（NapCat 侧配置 HTTP 服务端）。
// 发送节流 ≥3s + 随机抖动（社区共识：秒回/高频是风控信号）。
// 发送调用改编自 dsh-whale-notify（MIT © Lenai）的 sendQQ。

import { normalizeId } from './onebot.js'

const HTTP_TIMEOUT_MS = 15000
// 两条发送之间至少隔 3 秒，再加 0~2 秒随机抖动
const SEND_GAP_MS = 3000
const JITTER_MS = 2000

async function call(config, action, body, { fetch: fetcher = globalThis.fetch } = {}) {
  const base = (config?.httpBase ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
  const headers = { 'Content-Type': 'application/json' }
  if (config?.accessToken) headers.Authorization = `Bearer ${config.accessToken}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`QQ 接口超时（${HTTP_TIMEOUT_MS}ms）`)), HTTP_TIMEOUT_MS)
  let response
  try {
    response = await fetcher(`${base}/${action}`, {
      method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: controller.signal,
    })
  } catch (error) {
    throw new Error(`无法连接 OneBot 接口 ${base}（NapCat 是否在运行？）：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
  const data = await response.json().catch(() => ({}))
  // OneBot 实现对 retcode 处理不一致：status=ok 或 retcode=0 都算成功
  if (data.status !== 'ok' && data.retcode !== 0) {
    throw new Error(`QQ 调用失败 (${data.retcode ?? response.status}): ${data.message ?? data.wording ?? '无响应体'}`)
  }
  return data.data
}

export function createQQApi({ config, fetch: fetcher = globalThis.fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastSendAt = 0
  let queue = Promise.resolve()

  async function send(action, params) {
    const job = queue.then(async () => {
      const gap = now() - lastSendAt
      const need = SEND_GAP_MS - gap
      if (need > 0) await sleep(need + Math.floor(Math.random() * JITTER_MS))
      lastSendAt = now()
      return call(config, action, params, { fetch: fetcher })
    })
    queue = job.catch(() => {})
    return job
  }

  return {
    /** 任意 OneBot 动作（含 NapCat 扩展，如 get_friend_msg_history） */
    call(action, params) {
      return call(config, action, params, { fetch: fetcher })
    },
    /** 私聊发送（高危动作，调用方须过审批门） */
    sendPrivate(userId, text) {
      return send('send_private_msg', { user_id: normalizeId(userId), message: text })
    },
    /** 群发送（高危动作） */
    sendGroup(groupId, text) {
      return send('send_group_msg', { group_id: normalizeId(groupId), message: text })
    },
    getLoginInfo() {
      return call(config, 'get_login_info', {}, { fetch: fetcher })
    },
    getFriendList() {
      return call(config, 'get_friend_list', {}, { fetch: fetcher })
    },
  }
}
