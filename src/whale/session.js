// 会话桥：把"该醒来了"投递进她在 DSH 里的专属会话。
// 模式取自 dsh-bili-whale（MIT）：会话 id 持久化复用；进程重启后首次投递重注人设；
// 投递串行化；失败不覆盖旧会话。

import { readFile } from 'node:fs/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export function createSessionBridge({ controller, whaleHome, cwd, workspaceId, personaBlock, model, log = () => {} }) {
  const stateFile = path.join(whaleHome, 'session.json')
  let state = null
  let booted = false
  let ready = false
  let modelSet = false
  let tail = Promise.resolve()
  let currentAbort = null

  async function load() {
    if (state) return state
    try {
      const saved = JSON.parse(await readFile(stateFile, 'utf8'))
      if (typeof saved.sessionId === 'string' && saved.sessionId) {
        state = saved
        return state
      }
    } catch {}
    state = { sessionId: crypto.randomUUID(), startedAt: Date.now() }
    return state
  }

  async function save(next) {
    await mkdir(path.dirname(stateFile), { recursive: true })
    await writeFile(stateFile, JSON.stringify(next, null, 2) + '\n')
  }

  // text: 唤醒提示词；注入人设（重启后首次必注入）后经 sessionController.prompt 投递
  function wake(text) {
    const job = tail.then(async () => {
      const st = await load()
      let prefix = ''
      if (!booted || !st.personaHash) {
        const block = personaBlock()
        prefix = block + '\n\n'
        st.personaHash = crypto.createHash('sha256').update(block).digest('hex')
      }
      // sessionController 的 create/prompt 都需要显式 AbortSignal
      currentAbort = new AbortController()
      const signal = currentAbort.signal
      if (!ready) {
        try {
          // workspaceId 与 cwd 互斥：有工作区则挂载（UI 分组），否则回退纯目录
          await controller.create(
            workspaceId ? { sessionId: st.sessionId, workspaceId } : { sessionId: st.sessionId, cwd },
            signal,
          )
        } catch {
          log('沿用现有会话；若投递失败将重试')
        }
        ready = true
      }
      // 会话模型固定：默认 deepseek-flash + 低思考档（快速直答），runtime.model 可覆盖
      if (!modelSet && model) {
        modelSet = true
        const selection = typeof model === 'string'
          ? { model, ...(model === 'deepseek-flash' ? { reasoningEffort: 'low' } : {}) }
          : { ...model }
        try {
          const r = await controller.selectModel({ sessionId: st.sessionId, provider: 'deepseek-official', ...selection })
          log(`会话模型已固定：${r.selected.model}${r.selected.reasoningEffort ? `（思考档：${r.selected.reasoningEffort}）` : '（无思考，直答）'}`)
        } catch (e) {
          modelSet = false
          log(`模型切换失败（沿用 DSH 默认）：${e.message}`)
        }
      }
      try {
        await controller.prompt({
          // requestId 必传：包装层会把它放进消息 source，缺失时 rpcId=undefined
          // 会污染事件并触发 "carries non-JSON-serializable data"
          requestId: `whale-life-${Date.now()}`,
          sessionId: st.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: prefix + text }],
        }, signal)
      } catch (e) {
        ready = false
        throw e
      }
      booted = true
      st.deliveredAt = Date.now()
      await save(st)
    })
    tail = job.catch(() => {})
    return job
  }

  // DSH 关闭时中止在途投递
  function abort() {
    currentAbort?.abort()
  }

  return { wake, abort, get sessionId() { return state?.sessionId ?? null } }
}
