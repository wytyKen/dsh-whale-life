// 行动层：大脑（DSH 会话）输出行动意图 → 审批 → 执行通道（平台提供）→ 留痕。
//
// 当前状态：骨架。解析/审批/outbox 留痕全部就绪，ACTION_CATALOG 为空——
// 等对外平台（QQ 等）回归时，在此登记行动集并在 executor 接执行分支即可，
// 审批纪律不随平台变化：
//   - 只读类（kind:'read'）免审——她看世界不受限；
//   - 对外可见的写操作（kind:'write'）走审批档 dry-run/semi/auto，semi 下默认草稿；
//   - 未列入白名单的 op 一律草稿——任何提示词都绕不过这里。

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTBOX_DIR = path.join(PLUGIN_ROOT, 'data', 'outbox')

// ── 能力目录（注入唤醒提示；平台回归时在此登记）──────────
export const ACTION_CATALOG = []

// ── 审批裁决（纯函数，可测）────────────────────────────
export function decideAction({ op, approvalMode }) {
  const entry = ACTION_CATALOG.find((a) => a.op === op)
  if (!entry) return { execute: false, reason: `未知行动 ${op}（不在能力白名单）` }
  if (entry.kind === 'read') return { execute: true, reason: '只读行动免审' }
  if (approvalMode === 'dry-run') return { execute: false, reason: 'dry-run：只记录不执行' }
  if (approvalMode === 'auto') return { execute: true, reason: 'auto：自主档直发（仍留痕）' }
  return { execute: false, reason: 'semi：主动行动默认草稿（主人可在设置页放行）' }
}

// ── 解析模型输出中的行动块 ─────────────────────────────
// 约定：她在回复末尾写 ```action\n[{"op":"..."}]\n```（JSON 数组，每项一个行动）
export function parseActionBlock(text) {
  if (typeof text !== 'string' || !text.includes('```action')) return []
  const actions = []
  for (const m of text.matchAll(/```action\s*([\s\S]*?)```/g)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) actions.push(...parsed.filter((a) => a && typeof a.op === 'string'))
    } catch { /* 坏 JSON 忽略——模型格式错不该炸整个唤醒 */ }
  }
  return actions
}

// ── 执行器 ────────────────────────────────────────────
export function createActionExecutor({ getApprovalMode = () => 'semi', outboxDir = OUTBOX_DIR, log = () => {} } = {}) {
  async function saveDraft(whaleId, action, decision, result = null) {
    await mkdir(outboxDir, { recursive: true })
    const record = {
      at: new Date().toISOString(), via: 'action', whale: whaleId,
      op: action.op, params: { ...action },
      executed: false, reason: decision.reason, result,
    }
    const file = path.join(outboxDir, `act-${Date.now()}.json`)
    await writeFile(file, JSON.stringify(record, null, 2) + '\n')
    return file
  }

  /**
   * 执行（或存草稿）一个行动。返回 { status: 'executed'|'drafted'|'error', detail }
   */
  async function execute(whaleId, action) {
    const decision = decideAction({ op: action.op, approvalMode: getApprovalMode(whaleId) })
    if (!decision.execute) {
      const file = await saveDraft(whaleId, action, decision)
      log(`行动草稿：${action.op}（${decision.reason}）→ ${path.basename(file)}`)
      return { status: 'drafted', detail: decision.reason, file }
    }
    // 执行通道：平台回归时在此按 op 分发。当前白名单为空，理论上到不了这里。
    return { status: 'error', detail: `行动 ${action.op} 没有执行通道（平台未接入）` }
  }

  return { execute }
}

// ── 唤醒提示的能力段（注入 wake prompt）────────────────
export function actionCatalogPrompt() {
  if (ACTION_CATALOG.length === 0) return '' // 空目录不注入（不浪费她的注意力）
  const lines = ['【行动能力】你想主动做事时，在回复的最末尾写一个 action 代码块（JSON 数组，每项一个行动）：']
  for (const a of ACTION_CATALOG.filter((x) => x.kind !== 'read')) {
    lines.push(`- {"op":"${a.op}", …} —— ${a.desc}（参数：${a.params}）`)
  }
  lines.push('规则：只在真想做时输出；没有行动就完全不要写这个块；发布类行动默认会先成为草稿等主人放行。')
  return lines.join('\n')
}
