// dsh-native 平台：她的「内置对话」——在 DSH Web 的她的工作区里，
// 用户开的新会话就是和她聊天的一个对话框。
//
// 工作方式：
//   每只鲸一个工作区（workspaceRegistry）→ 轮询该工作区的 sessionIds
//   → 发现新会话且未注入 → 以 queue 模式投递「启动提示」（人设+共享记忆）
//   → 用户随后的发言自然排在提示之后 → 模型以她的人格应答
//   → 每轮对话完成后摘要回流进共享记忆（所有对话互通）
//
// 与 QQ 时代透明管线同构：模型只管"说话"，插件负责"成为她"。

import { primingWithMemory } from '../../behavior/priming.js'
import { recordFact } from '../../memory/store.js'
import { getProjcacheStats, waitTurnComplete } from '../../whale/projcache.js'

const POLL_INTERVAL_MS = 3000

/**
 * 为一只鲸装配内置对话能力。
 * @returns {{ stop(): void, state(): object } | null}
 */
export function registerDshNative({ whale, home, ctx, workspaceId, persona, bridge, log = () => {} }) {
  if (!workspaceId) {
    log(`⚠ #${whale.id} 内置对话需要工作区（workspaceId 缺失）——未接入`)
    return null
  }

  const primed = new Set()   // 已注入启动提示的会话
  const active = new Map()   // sessionId → { title, lastAt, turns }（面板展示）
  let stopped = false

  function isOwnSession(sessionId) {
    // 生命会话（wake 用）有自己的提示体系，不注入对话启动提示
    return bridge && bridge.sessionId === sessionId
  }

  async function injectPriming(sessionId) {
    try {
      const text = await primingWithMemory(persona, home)
      await ctx.sessionController.prompt({
        requestId: `wl-native-${Date.now()}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      }, new AbortController().signal)
      primed.add(sessionId)
      active.set(sessionId, { title: null, lastAt: Date.now(), turns: 0 })
      log(`内置对话就绪：会话 ${sessionId.slice(0, 8)}… 已注入「${persona.name}」（含共享记忆）`)
    } catch (e) {
      log(`启动提示注入失败（会话 ${sessionId.slice(0, 8)}…）：${e.message}`)
    }
  }

  // 发现新会话：轮询工作区（attach 在 create 之后，事件时机早于绑定——轮询最稳）
  async function scan() {
    if (stopped) return
    let ws = null
    try {
      ws = typeof ctx.workspaceRegistry?.get === 'function' ? ctx.workspaceRegistry.get(workspaceId) : null
    } catch { /* registry 未就绪 */ }
    const ids = ws?.sessionIds ?? []
    for (const sessionId of ids) {
      if (primed.has(sessionId) || isOwnSession(sessionId)) continue
      // 会话可能是插件历史（持久化会话重启后仍在工作区）——已存在多轮的不再注入，
      // 只有「新面孔」才注入（turns ≤ 1 视为还没聊过）
      const st = await getProjcacheStats(sessionId)
      const turns = st?.stats?.turns ?? 0
      if (turns > 1) { primed.add(sessionId); active.set(sessionId, { title: null, lastAt: Date.now(), turns }); continue }
      await injectPriming(sessionId)
    }
    // 清理已移出工作区的会话展示
    const live = new Set(ids)
    for (const key of active.keys()) if (!live.has(key)) active.delete(key)
  }

  // 回流：被注入的会话完成一轮 → 摘要写入共享记忆（她跟所有人的对话互通）
  function watchMemory(sessionId) {
    const base = active.get(sessionId)
    if (!base) return
    const baseline = base.turns
    waitTurnComplete(sessionId, baseline, { timeoutMs: 300_000 }).then((reply) => {
      if (stopped || !reply) return
      const entry = active.get(sessionId)
      if (!entry) return
      entry.turns = baseline + 1
      entry.lastAt = Date.now()
      // 摘要式回流：取末段（避免记忆被长对话淹没），200 字内
      const digest = reply.replace(/\s+/g, ' ').slice(-200)
      recordFact(home, { kind: 'chat', text: `对话（会话 ${sessionId.slice(0, 8)}）她说了：${digest}` }).catch(() => {})
    }).catch(() => {})
  }

  // 每 5s 刷新一次面板数据的轮次（轻量：只读 projcache 统计）
  async function refreshStats() {
    if (stopped) return
    for (const [sessionId, entry] of active) {
      try {
        const st = await getProjcacheStats(sessionId)
        const turns = st?.stats?.turns ?? 0
        if (turns > entry.turns) {
          entry.turns = turns
          entry.lastAt = Date.now()
          // 轮次推进且新回复落定 → 回流
          const last = st.outline?.turns?.[turns - 1]
          if (last?.response) {
            const digest = String(last.response).replace(/\s+/g, ' ').slice(-200)
            recordFact(home, { kind: 'chat', text: `对话（会话 ${sessionId.slice(0, 8)}）她说了：${digest}` }).catch(() => {})
          }
        }
      } catch { /* 单会话失败不拖垮 */ }
    }
  }

  const scanTimer = setInterval(() => { scan().catch(() => {}) }, POLL_INTERVAL_MS)
  const statTimer = setInterval(() => { refreshStats().catch(() => {}) }, 30_000)
  if (scanTimer.unref) scanTimer.unref()
  if (statTimer.unref) statTimer.unref()
  scan().catch(() => {})

  return {
    stop() {
      stopped = true
      clearInterval(scanTimer)
      clearInterval(statTimer)
    },
    state() {
      return {
        platform: 'dsh-native',
        workspaceId,
        sessions: [...active.entries()].map(([id, e]) => ({ id, title: e.title, turns: e.turns, lastAt: e.lastAt })),
      }
    },
  }
}
