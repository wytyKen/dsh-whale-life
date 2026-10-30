// 离线消息补收：DSH 关闭期间错过的私聊，在她「醒来」（插件启动）时补看。
// 数据流：来信时 session 层持久化 peers → 启动时对每个 peer 拉 NapCat 历史
//（get_friend_msg_history 扩展动作）→ 有新消息则唤醒她处理。

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const CATCHUP_PEERS = 5   // 最多回看最近 5 个会话
const CATCHUP_MSGS = 5    // 每个会话最多补 5 条

async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(tmp, data)
    await rename(tmp, file)
  } finally {
    await rm(tmp, { force: true })
  }
}

export function createPeerStore(file) {
  async function load() {
    try { return JSON.parse(await readFile(file, 'utf8')) } catch { return {} }
  }
  return {
    async record(peerKey, { name, kind, lastAtOverride }) {
      const peers = await load()
      peers[peerKey] = { ...(peers[peerKey] ?? {}), lastAt: lastAtOverride ?? Date.now(), name, kind }
      await atomicWrite(file, JSON.stringify(peers, null, 2) + '\n')
    },
    load,
  }
}

/**
 * 启动补收：拉离线期间的私聊，有漏则唤醒她。
 * @returns 唤醒的会话数
 */
export async function runCatchUp({ api, bridge, peersFile, selfId, routePort = 3939, log = () => {} }) {
  const store = createPeerStore(peersFile)
  const peers = await store.load()
  const entries = Object.entries(peers)
    .filter(([key, v]) => !key.startsWith('group:') && v?.lastAt)
    .sort((a, b) => b[1].lastAt - a[1].lastAt)
    .slice(0, CATCHUP_PEERS)

  let woken = 0
  for (const [peerKey, meta] of entries) {
    try {
      const history = await api.call('get_friend_msg_history', {
        user_id: Number(peerKey), count: CATCHUP_MSGS, message_seq: 0,
      })
      // 只补「对方发的、lastAt 之后」的消息（她自己此前发的回复不算遗漏）
      const messages = (history?.messages ?? [])
        .filter((m) => Number(m?.time ?? 0) * 1000 > meta.lastAt)
        .filter((m) => selfId === undefined || String(m?.sender?.user_id ?? '') !== String(selfId))
      if (!messages.length) continue

      const summary = messages.map((m) => `${meta.name ?? peerKey}：${extractText(m.message)}`).join('\n')
      log(`离线补收：${peerKey} 有 ${messages.length} 条新消息`)
      await bridge.wake([
        `【离线补收】你睡着的时候（${new Date(meta.lastAt).toLocaleString('zh-CN')} 之后），收到：`,
        summary,
        `【回应】这些是错过的消息，由你决定要不要补回复；用 fetch POST http://127.0.0.1:${routePort}/qq/send 回复（对方来过信，窗口有效），或记进日记就好。`,
      ].join('\n'))
      // 补收后把窗口刷新为「刚来过」，让她可以直接回
      const now = Date.now()
      await store.record(peerKey, { name: meta.name, kind: meta.kind, lastAtOverride: now })
      woken += 1
    } catch (e) {
      log(`补收 ${peerKey} 失败（跳过）：${e.message}`)
    }
  }
  return woken
}

function extractText(message) {
  if (typeof message === 'string') return message.replace(/\[CQ:[^\]]*\]/g, '').trim()
  if (Array.isArray(message)) {
    return message.map((s) => (s?.type === 'text' ? s.data?.text ?? '' : '')).join('').trim()
  }
  return ''
}
