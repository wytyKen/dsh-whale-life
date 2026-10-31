// 行动层：大脑（DSH 会话）输出行动意图 → 审批 → 身体（NapCat OneBot action）执行 → 留痕。
// 与聊天管线的分工：聊天里她只管"说话"（透明管线）；主动做事（发动态等）走本模块。
//
// 纪律（对应 docs/napcat-actions.md 的能力映射）：
//   - 只读类（read）免审——她看世界不受限；
//   - 对外可见的写操作（publish 等）走审批档 dry-run/semi/auto，semi 下主动操作默认草稿、主人放行；
//   - 未列入白名单的 op 一律草稿——白名单之外的任何意图都不直接执行。

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTBOX_DIR = path.join(PLUGIN_ROOT, 'data', 'outbox')

// ── 能力目录（注入唤醒提示；也决定前端展示）──────────────
export const ACTION_CATALOG = [
  { op: 'qzone.publish', kind: 'write', desc: '发QQ空间说说', params: 'content（正文）、visibility（1所有人/4好友/64仅自己，默认1）' },
  { op: 'qzone.delete', kind: 'write', desc: '删除自己的说说', params: 'tid（来自发布返回或动态流）' },
  { op: 'qzone.read', kind: 'read', desc: '看最近的动态流', params: '无（只读，免审）' },
]

// ── 审批裁决（纯函数，可测）────────────────────────────
// 与 decideSend 同律：dry-run 一律草稿；auto 直发；semi 下主动发布类（无来信窗口概念）→ 草稿。
export function decideAction({ op, approvalMode }) {
  const entry = ACTION_CATALOG.find((a) => a.op === op)
  if (!entry) return { execute: false, reason: `未知行动 ${op}（不在能力白名单）` }
  if (entry.kind === 'read') return { execute: true, reason: '只读行动免审' }
  if (approvalMode === 'dry-run') return { execute: false, reason: 'dry-run：只记录不执行' }
  if (approvalMode === 'auto') return { execute: true, reason: 'auto：自主档直发（仍留痕）' }
  return { execute: false, reason: 'semi：主动行动默认草稿（主人可在设置页放行）' }
}

// ── 解析模型输出中的行动块 ─────────────────────────────
// 约定：她在回复末尾写 ```action\n[{"op":"qzone.publish","content":"…"}]\n```（JSON 数组，每项一个行动）
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
export function createActionExecutor({ getQQ, outboxDir = OUTBOX_DIR, log = () => {} } = {}) {
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
    const qq = getQQ?.(whaleId)
    if (!qq) return { status: 'error', detail: 'QQ 未接入（NapCat 未连接）' }
    try {
      let result
      if (action.op === 'qzone.publish') {
        result = await qq.api.call('send_qzone_msg', {
          content: String(action.content ?? ''),
          ugc_right: Number(action.visibility ?? 1),
        })
      } else if (action.op === 'qzone.delete') {
        result = await qq.api.call('delete_qzone_msg', { tid: String(action.tid ?? '') })
      } else if (action.op === 'qzone.read') {
        result = await qq.api.call('get_qzone_feeds', {})
      } else {
        return { status: 'error', detail: `未知行动 ${action.op}` }
      }
      // 留痕（执行的也记录，便于审计）
      await saveDraft(whaleId, action, decision, result)
      log(`行动已执行：${action.op}（#${whaleId}）`)
      return { status: 'executed', detail: result }
    } catch (e) {
      return { status: 'error', detail: String(e?.message ?? e) }
    }
  }

  function getApprovalMode(whaleId) {
    return getQQ?.(whaleId)?.whale?.approvalMode ?? 'semi'
  }

  return { execute }
}

// ── 唤醒提示的能力段（注入 wake prompt）────────────────
export function actionCatalogPrompt() {
  const lines = ['【行动能力】你想主动做事时，在回复的最末尾写一个 action 代码块（JSON 数组，每项一个行动）：']
  for (const a of ACTION_CATALOG.filter((x) => x.op !== 'qzone.read')) {
    lines.push(`- {"op":"${a.op}", …} —— ${a.desc}（参数：${a.params}）`)
  }
  lines.push('```action')
  lines.push('[{"op":"qzone.publish","content":"今晚的月色像深海一样安静。","visibility":1}]')
  lines.push('```')
  lines.push('规则：只在真想做时输出；没有行动就完全不要写这个块；发布类行动默认会先成为草稿等主人放行。')
  return lines.join('\n')
}
