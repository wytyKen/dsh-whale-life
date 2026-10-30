// QQ 会话层：策略过滤 → 消息合流 → 透传给会话管理器（per-peer DSH 会话）
// → 回复捕获器自动从 QQ 发回。模型只管"说话"，插件负责"送话"。

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MERGE_WINDOW_MS = 8_000  // 连续消息的合流窗口
const MERGE_MAX = 5            // 超过此数立即出发

export function createQQSession({ whale, api, selfId, conversationManager, responder, recentPeers, peerStore, log = () => {} }) {
  const passive = whale.rhythm.passive
  const dmPolicy = whale.socialBounds.dmPolicy
  const buffers = new Map() // peerKey → { timer, messages: [] }

  async function handle(message) {
    // ── 来信登记 ──────────────────────────────────────────
    const peerKey = message.type === 'private' ? String(message.userId) : `group:${message.groupId}`
    if (recentPeers) {
      recentPeers.set(peerKey, Date.now())
      if (recentPeers.size > 200) recentPeers.clear()
    }
    if (message.type === 'private') {
      peerStore?.record(peerKey, { name: message.senderName, kind: 'private' }).catch(() => {})
    }

    // ── 策略过滤 ──────────────────────────────────────────
    if (message.type === 'group') {
      if (!(message.atMe || message.isReply)) return
      if (passive.onMention === 'ignore') return
    } else {
      if (passive.onDM === 'ignore') return
      if (dmPolicy !== 'everyone') {
        log(`私聊（${message.userId}）按 dmPolicy=${dmPolicy} 只记录不唤醒`)
        return
      }
    }

    // ── 消息合流 ──────────────────────────────────────────
    let buf = buffers.get(peerKey)
    if (!buf) {
      buf = { timer: null, messages: [] }
      buffers.set(peerKey, buf)
    }
    buf.messages.push(message)
    if (buf.timer) clearTimeout(buf.timer)
    if (buf.messages.length >= MERGE_MAX) {
      flush(peerKey).catch((e) => log(`投递失败：${e.message}`))
    } else {
      buf.timer = setTimeout(() => {
        flush(peerKey).catch((e) => log(`投递失败：${e.message}`))
      }, MERGE_WINDOW_MS)
    }
  }

  async function flush(peerKey) {
    const buf = buffers.get(peerKey)
    if (!buf || buf.messages.length === 0) return
    buffers.delete(peerKey)
    if (buf.timer) clearTimeout(buf.timer)
    const messages = buf.messages
    const first = messages[0]
    const peerName = first.senderName ?? first.userId

    // ── 透传给会话管理器（原始消息，零包装）──────────────
    // 多条消息合并为一次投递，保持原文
    const rawText = messages
      .map((m) => `${m.senderName ?? m.userId}：${m.text}`)
      .join('\n')
    // 如果是同一个人连续发的，只保留名字在第一行（更自然的聊天格式）
    const samePerson = messages.every((m) => String(m.userId) === String(first.userId))
    const formattedText = samePerson
      ? messages.map((m) => m.text).join('\n')
      : rawText

    const conv = await conversationManager.sendMessage(peerKey, peerName, formattedText)
    if (!conv) {
      log(`会话投递失败（${peerKey}），消息未送达模型`)
      return
    }
    log(`已透传 → 会话 ${conv.sessionId.slice(0, 8)}…（${peerName}${messages.length > 1 ? ` ×${messages.length}` : ''}）`)

    // ── 启动回复监听（模型回复完成 → 自动从 QQ 发回）────
    responder.watchForResponse(peerKey, conv)
  }

  return { handle }
}
