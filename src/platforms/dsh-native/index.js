// dsh-native 平台：她的「内置对话」——在 DSH Web 的她的工作区里，
// 用户开的每个会话就是和她聊天的一个对话框。
//
// 人设注入走 agent/pre-step 管道：每轮组装发给模型的消息时，在她的会话
// 消息列表最前面置入启动提示（人设+共享记忆）——模型看得见，UI 对话流
// 里完全不出现（不会像投递消息那样「自动发送」）。记忆每轮实时取，
// 别的对话框里聊的内容，下一轮就能被她想起。
//
// 面板展示与记忆回流：轮询工作区会话清单 + projcache 轮次统计。

import { primingWithMemory } from '../../behavior/priming.js'
import { recordFact } from '../../memory/store.js'
import { getProjcacheStats } from '../../whale/projcache.js'

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

  const active = new Map() // sessionId → { title, lastAt, turns }（面板展示）
  const known = new Set()  // 见过的工作区会话
  let stopped = false

  function sessionBelongsToWhale(sessionId) {
    try {
      const ws = typeof ctx.workspaceRegistry?.get === 'function' ? ctx.workspaceRegistry.get(workspaceId) : null
      return ws?.sessionIds?.includes(sessionId) ?? false
    } catch {
      return false
    }
  }

  // ── 人设管道：她的会话每轮组装时，前置启动提示（模型可见，UI 不可见）────
  // 全局 ctx 上的监听同样收到 agent 作用域内派发的事件；用 payload.agent 判归属。
  const disposePipe = ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    const decision = await next()
    try {
      if (!decision || decision.kind === 'reject' || stopped) return decision
      const sessionId = agent?.session?.header?.id
      if (!sessionId || !sessionBelongsToWhale(sessionId)) return decision
      if (bridge && bridge.sessionId === sessionId) return decision // 生命会话有自己的提示体系
      const text = await primingWithMemory(persona, home)
      return {
        ...decision,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', form: 'persona', summary: `${persona.name} 的启动提示` },
        }, ...decision.messages],
      }
    } catch (e) {
      log(`人设管道出错（本轮跳过，不影响对话）：${e.message}`)
      return decision
    }
  })

  // ── 会话发现：轮询工作区（面板展示 + 记忆回流的登记表）──────────────
  async function scan() {
    if (stopped) return
    let ws = null
    try {
      ws = typeof ctx.workspaceRegistry?.get === 'function' ? ctx.workspaceRegistry.get(workspaceId) : null
    } catch { /* registry 未就绪 */ }
    const ids = ws?.sessionIds ?? []
    for (const sessionId of ids) {
      if (known.has(sessionId)) continue
      if (bridge && bridge.sessionId === sessionId) { known.add(sessionId); continue }
      known.add(sessionId)
      const st = await getProjcacheStats(sessionId)
      active.set(sessionId, { title: null, lastAt: Date.now(), turns: st?.stats?.turns ?? 0 })
    }
    const live = new Set(ids)
    for (const key of active.keys()) if (!live.has(key)) { active.delete(key); known.delete(key) }
  }

  // ── 记忆回流：她的回复落定后摘要写入共享记忆（所有对话互通）──────────
  async function refreshStats() {
    if (stopped) return
    for (const [sessionId, entry] of active) {
      try {
        const st = await getProjcacheStats(sessionId)
        const turns = st?.stats?.turns ?? 0
        if (turns > entry.turns) {
          entry.turns = turns
          entry.lastAt = Date.now()
          const last = st.outline?.turns?.[turns - 1]
          if (last?.response) {
            const digest = String(last.response).replace(/\s+/g, ' ').slice(-200)
            await recordFact(home, { kind: 'chat', text: `对话（会话 ${sessionId.slice(0, 8)}）她说了：${digest}` })
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
      try { disposePipe?.() } catch { /* 尽力而为 */ }
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
