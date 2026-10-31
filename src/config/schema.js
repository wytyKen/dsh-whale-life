// 鲸生配置 schema：README「配置一览」四组十四项的字段化定义。
// 只负责结构校验与默认值填充，不执行任何行为——行为系统按此契约逐步实现。

export const WHALE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export const APPROVAL_MODES = ['auto', 'semi', 'dry-run']
export const FRIEND_POLICIES = ['auto-accept', 'ask-owner', 'reject']
export const DM_POLICIES = ['off', 'friends-only', 'everyone']
export const PASSIVE_ACTIONS = ['ignore', 'read', 'reply']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
const isStrArr = (v) => Array.isArray(v) && v.every(isStr)

function enumCheck(value, allowed, field) {
  if (!allowed.includes(value)) {
    return `「${field}」必须是 ${allowed.map((x) => `'${x}'`).join(' / ')} 之一，当前为 '${value}'`
  }
  return null
}

function validateAccount(account, i) {
  const errors = []
  if (!isObj(account)) return [`accounts[${i}] 必须是对象`]
  if (!isStr(account.platform) || !account.platform) {
    errors.push(`accounts[${i}].platform 必须是非空字符串（如 bilibili / qq）`)
  }
  if (account.allowRegister !== undefined && typeof account.allowRegister !== 'boolean') {
    errors.push(`accounts[${i}].allowRegister 必须是布尔值`)
  }
  return errors
}

function validateCronEntry(entry, i) {
  const errors = []
  if (!isObj(entry)) return [`rhythm.cron[${i}] 必须是对象`]
  if (!isStr(entry.expr) || !entry.expr) errors.push(`rhythm.cron[${i}].expr 必须是非空 cron 表达式`)
  if (!isStr(entry.action) || !entry.action) errors.push(`rhythm.cron[${i}].action 必须是非空动作描述`)
  return errors
}

function validateSource(source, i) {
  const errors = []
  if (!isObj(source)) return [`interests.sources[${i}] 必须是对象`]
  if (!isStr(source.type) || !source.type) errors.push(`interests.sources[${i}].type 必须是非空字符串（如 rss）`)
  if (!isStr(source.url) || !source.url) errors.push(`interests.sources[${i}].url 必须是非空字符串`)
  return errors
}

// 每鲸的平台开关：platforms.dsh = 内置对话（DSH 工作区里的会话即对话框）。
// 对外平台（QQ 等）回归时在 platforms 下恢复相应键。
function validatePlatforms(platforms, prefix) {
  const errors = []
  if (platforms.dsh !== undefined && typeof platforms.dsh !== 'boolean') {
    errors.push(`${prefix}.dsh 必须是布尔值（内置对话开关）`)
  }
  return errors
}

// 校验并规范化单只鲸鱼的配置，返回 { errors, value }
export function validateWhale(raw, index) {
  const errors = []
  const prefix = `whales[${index}]`
  const whale = { ...raw }

  if (!isObj(whale)) return { errors: [`${prefix} 必须是对象`], value: null }

  // ---- 本体 ----
  if (!isStr(whale.id) || !WHALE_ID_PATTERN.test(whale.id)) {
    errors.push(`${prefix}.id 必须匹配 ${WHALE_ID_PATTERN}（小写字母/数字/连字符，如 'lingxi'）`)
  }
  if (whale.persona !== undefined && !isObj(whale.persona)) errors.push(`${prefix}.persona 必须是对象`)
  if (whale.identity !== undefined && !isObj(whale.identity)) errors.push(`${prefix}.identity 必须是对象`)

  // ---- 账号与边界 ----
  if (whale.accounts !== undefined) {
    if (!Array.isArray(whale.accounts)) errors.push(`${prefix}.accounts 必须是数组`)
    else whale.accounts.forEach((a, i) => errors.push(...validateAccount(a, i)))
  }
  if (whale.platforms !== undefined && !isObj(whale.platforms)) errors.push(`${prefix}.platforms 必须是对象`)
  if (whale.platforms) errors.push(...validatePlatforms(whale.platforms, `${prefix}.platforms`))
  if (whale.permissions !== undefined && !isObj(whale.permissions)) errors.push(`${prefix}.permissions 必须是对象`)
  if (whale.socialBounds !== undefined && !isObj(whale.socialBounds)) errors.push(`${prefix}.socialBounds 必须是对象`)
  whale.approvalMode = whale.approvalMode ?? 'semi'
  const approvalError = enumCheck(whale.approvalMode, APPROVAL_MODES, `${prefix}.approvalMode`)
  if (approvalError) errors.push(approvalError)
  if (whale.socialBounds?.friendPolicy !== undefined) {
    const e = enumCheck(whale.socialBounds.friendPolicy, FRIEND_POLICIES, `${prefix}.socialBounds.friendPolicy`)
    if (e) errors.push(e)
  }
  if (whale.socialBounds?.dmPolicy !== undefined) {
    const e = enumCheck(whale.socialBounds.dmPolicy, DM_POLICIES, `${prefix}.socialBounds.dmPolicy`)
    if (e) errors.push(e)
  }

  // ---- 行为节律 ----
  if (whale.rhythm !== undefined && !isObj(whale.rhythm)) errors.push(`${prefix}.rhythm 必须是对象`)
  if (whale.rhythm?.cron !== undefined) {
    if (!Array.isArray(whale.rhythm.cron)) errors.push(`${prefix}.rhythm.cron 必须是数组`)
    else whale.rhythm.cron.forEach((c, i) => errors.push(...validateCronEntry(c, i)))
  }
  for (const key of ['onMention', 'onDM', 'onComment']) {
    const action = whale.rhythm?.passive?.[key]
    if (action !== undefined) {
      const e = enumCheck(action, PASSIVE_ACTIONS, `${prefix}.rhythm.passive.${key}`)
      if (e) errors.push(e)
    }
  }
  if (whale.limits !== undefined && !isObj(whale.limits)) errors.push(`${prefix}.limits 必须是对象`)

  // ---- 兴趣 / 运行 ----
  if (whale.interests !== undefined && !isObj(whale.interests)) errors.push(`${prefix}.interests 必须是对象`)
  if (whale.interests?.sources !== undefined) {
    if (!Array.isArray(whale.interests.sources)) errors.push(`${prefix}.interests.sources 必须是数组`)
    else whale.interests.sources.forEach((s, i) => errors.push(...validateSource(s, i)))
  }
  if (whale.interests?.topics !== undefined && !isStrArr(whale.interests.topics)) {
    errors.push(`${prefix}.interests.topics 必须是字符串数组`)
  }
  if (whale.runtime !== undefined && !isObj(whale.runtime)) errors.push(`${prefix}.runtime 必须是对象`)

  return { errors, value: errors.length ? null : whale }
}

// 填充单只鲸鱼的默认值（在结构校验通过后调用）
export function withDefaults(whale) {
  return {
    id: whale.id,
    platforms: {
      // 内置对话（DSH 工作区会话 = 对话框）默认开启
      dsh: whale.platforms?.dsh ?? true,
    },
    persona: whale.persona ?? {},
    identity: {
      displayName: whale.identity?.displayName ?? whale.id,
      avatar: whale.identity?.avatar ?? 'identity/avatar.png',
      bio: whale.identity?.bio ?? '',
      perPlatform: whale.identity?.perPlatform ?? {},
    },
    accounts: (whale.accounts ?? []).map((a) => ({
      platform: a.platform,
      credentials: a.credentials ?? null,
      allowRegister: a.allowRegister ?? false,
    })),
    permissions: {
      allow: whale.permissions?.allow ?? [],
      deny: whale.permissions?.deny ?? [],
    },
    socialBounds: {
      deniedTopics: whale.socialBounds?.deniedTopics ?? [],
      friendPolicy: whale.socialBounds?.friendPolicy ?? 'ask-owner',
      dmPolicy: whale.socialBounds?.dmPolicy ?? 'friends-only',
      blacklist: whale.socialBounds?.blacklist ?? [],
    },
    approvalMode: whale.approvalMode ?? 'semi',
    rhythm: {
      timezone: whale.rhythm?.timezone ?? 'Asia/Shanghai',
      cron: (whale.rhythm?.cron ?? []).map((c) => ({ expr: c.expr, action: c.action })),
      passive: {
        onMention: whale.rhythm?.passive?.onMention ?? 'reply',
        onDM: whale.rhythm?.passive?.onDM ?? 'read',
        onComment: whale.rhythm?.passive?.onComment ?? 'reply',
      },
    },
    limits: {
      dailyTokens: whale.limits?.dailyTokens ?? null,
      dailyModelCalls: whale.limits?.dailyModelCalls ?? null,
      dailyPosts: whale.limits?.dailyPosts ?? 10,
    },
    interests: {
      topics: whale.interests?.topics ?? [],
      sources: (whale.interests?.sources ?? []).map((s) => ({ type: s.type, url: s.url })),
    },
    runtime: {
      model: whale.runtime?.model ?? null,
      report: {
        dailySummary: whale.runtime?.report?.dailySummary ?? true,
        events: whale.runtime?.report?.events ?? ['high-risk-action'],
      },
      backup: { dir: whale.runtime?.backup?.dir ?? 'data/backups' },
    },
  }
}

// 入口：校验整个插件配置，返回 { ok, errors, whales }
export function loadConfig(config) {
  if (config === undefined || config === null) config = {}
  if (!isObj(config)) return { ok: false, errors: ['插件配置必须是对象'], whales: [] }

  const errors = []
  if (config.whales !== undefined && !Array.isArray(config.whales)) {
    return { ok: false, errors: ['whales 必须是数组，每只鲸鱼一个条目'], whales: [] }
  }

  const whales = []
  const seen = new Set()
  for (const [i, raw] of (config.whales ?? []).entries()) {
    const { errors: whaleErrors, value } = validateWhale(raw, i)
    errors.push(...whaleErrors)
    if (!value) continue
    if (seen.has(value.id)) errors.push(`whales[${i}].id '${value.id}' 重复，每只鲸鱼的 id 必须唯一`)
    else {
      seen.add(value.id)
      whales.push(withDefaults(value))
    }
  }

  return { ok: errors.length === 0, errors, whales }
}
