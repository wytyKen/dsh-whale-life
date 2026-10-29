// 四档审批门：所有对外动作的唯一收口（平台适配器写入前必须经过这里）。
// live      直接执行（仍受限速与每日预算约束）
// semi      高危动作转待审（outbox），普通动作放行
// dry-run   一切对外动作只落 outbox 记录，不真正发出
// frozen    风控熔断后的自动只读档（由 risk 状态机设置，优先于用户配置）

export const TIERS = ['live', 'semi', 'dry-run', 'frozen']

// 动作风险分级：平台适配器申报，收口统一裁决
export function classifyRisk(action) {
  if (typeof action !== 'string' || !action) return { class: 'unknown', highRisk: true }
  const a = action.toLowerCase()
  if (/^(send_private|send_group|send_msg|post|publish|create_dyn|add_comment|add_friend|set_avatar|set_nick)/.test(a)) {
    return { class: 'outbound', highRisk: true }
  }
  if (/^(get_|read|fetch|search|list)/.test(a)) return { class: 'read', highRisk: false }
  return { class: 'other', highRisk: true } // 未知动作默认按高危处理
}

export function createApprover({ mode = 'semi', frozen = false } = {}) {
  let isFrozen = frozen
  return {
    get mode() { return mode },
    get frozen() { return isFrozen },
    setFrozen(v) { isFrozen = Boolean(v) },

    // 裁决：{ allow: bool, route: 'live' | 'outbox' }
    decide(action) {
      const { highRisk } = classifyRisk(action)
      if (isFrozen) return { allow: false, route: 'outbox', reason: '风控熔断中（frozen），只读' }
      if (mode === 'live') return { allow: true, route: 'live' }
      if (mode === 'dry-run') {
        // 只记录不发布：读动作放行，一切对外发布转 outbox
        if (highRisk) return { allow: false, route: 'outbox', reason: 'dry-run：只记录不发布' }
        return { allow: true, route: 'live' }
      }
      // semi：读放行，写转待审
      if (highRisk) return { allow: false, route: 'outbox', reason: 'semi：高危动作待主人放行' }
      return { allow: true, route: 'live' }
    },
  }
}

// schema 的三档 approvalMode → 收口模式映射（frozen 由风控状态机叠加）
export function modeFromConfig(approvalMode) {
  return { auto: 'live', semi: 'semi', 'dry-run': 'dry-run' }[approvalMode] ?? 'semi'
}
