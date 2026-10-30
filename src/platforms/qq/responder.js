// 回复捕获器：监听模型回复完成，提取文本，从 QQ 发回。
// 模型不需要运行任何命令——它只是"说话"，插件替它"送话"。

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000 // 最多等 2 分钟

export function createResponder({ api, conversationManager, log = () => {} }) {
  const watching = new Set() // 防止同一会话重复监听

  /**
   * 发送消息后启动监听，模型回复完成后自动从 QQ 发回。
   * @param peerKey - QQ 用户 ID（数字字符串）或 group:xxx
   * @param conv - conversationManager 返回的会话对象
   */
  function watchForResponse(peerKey, conv) {
    if (watching.has(conv.sessionId)) return // 已在监听
    watching.add(conv.sessionId)

    const startTime = Date.now()
    // 记住发送前的轮次（用来判断新回复）
    let baselineTurns = conv.turns ?? 0

    const timer = setInterval(async () => {
      try {
        const elapsed = Date.now() - startTime
        if (elapsed > POLL_TIMEOUT_MS) {
          clearInterval(timer)
          watching.delete(conv.sessionId)
          log(`回复等待超时（${peerKey}，${elapsed / 1000}s）`)
          return
        }

        const data = await conversationManager.getSessionStats(conv.sessionId)
        if (!data?.stats) return // 文件还没写好

        const { turns, openStep } = data.stats
        conv.turns = turns

        // 轮次完成判定：openStep 为 null 且轮次数增加了
        if (openStep !== null) return // 还在思考
        if (turns <= baselineTurns) return // 没有新回复

        // ── 模型回复完成，提取文本 ──────────────────
        clearInterval(timer)
        watching.delete(conv.sessionId)

        const lastTurn = data.outline?.turns?.[turns - 1]
        const responseText = lastTurn?.response?.trim()
        if (!responseText) {
          log(`模型回复为空（${peerKey}，turn ${turns}）`)
          return
        }

        // 清理：去掉模型可能在回复前加的 "泠汐：" 前缀
        const cleaned = responseText.replace(/^(泠汐|我)\s*[：:]\s*/m, '').trim()
        if (!cleaned) return

        // ── 从 QQ 发回 ──────────────────────────────
        log(`回复就绪（${peerKey}）：${cleaned.slice(0, 60)}…`)
        try {
          const isGroup = String(peerKey).startsWith('group:')
          const peer = isGroup ? String(peerKey).slice(6) : peerKey
          const r = isGroup
            ? await api.sendGroup(peer, cleaned)
            : await api.sendPrivate(peer, cleaned)
          log(`已送达 → ${peerKey}（messageId=${r?.message_id}）`)

          // 记入共享记忆（谁说了什么、她回了什么）
          await conversationManager.saveMemory('chat', `回复了 ${peerKey}：${cleaned.slice(0, 100)}`)
        } catch (e) {
          log(`QQ 发送失败（${peerKey}）：${e.message}`)
        }
      } catch (e) {
        // 轮询出错不中断，继续等
      }
    }, POLL_INTERVAL_MS)

    // 防止 timer 阻止进程退出
    if (timer.unref) timer.unref()
  }

  return { watchForResponse }
}
