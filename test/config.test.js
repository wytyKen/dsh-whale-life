import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, withDefaults, APPROVAL_MODES } from '../src/config/schema.js'
import { resolvePersona, listTemplates, BLANK_PERSONA } from '../src/config/persona.js'
import { ensureWhaleDirs, vitalsLine, dataRoot } from '../src/whale/instance.js'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ---------- loadConfig ----------

test('空配置合法：她还在沉睡', () => {
  const r = loadConfig({})
  assert.equal(r.ok, true)
  assert.deepEqual(r.whales, [])
})

test('undefined / null 配置同样合法', () => {
  assert.equal(loadConfig(undefined).ok, true)
  assert.equal(loadConfig(null).ok, true)
})

test('whales 非数组报错', () => {
  const r = loadConfig({ whales: 'nope' })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /whales 必须是数组/)
})

test('非法 id 被拒绝', () => {
  const r = loadConfig({ whales: [{ id: 'Bad_Id!' }] })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /id 必须匹配/)
})

test('id 重复被拒绝', () => {
  const r = loadConfig({ whales: [{ id: 'a' }, { id: 'a' }] })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /重复/)
})

test('approvalMode 枚举校验', () => {
  const bad = loadConfig({ whales: [{ id: 'a', approvalMode: 'yolo' }] })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join('\n'), /approvalMode/)

  for (const mode of APPROVAL_MODES) {
    const good = loadConfig({ whales: [{ id: 'a', approvalMode: mode }] })
    assert.equal(good.ok, true, `approvalMode=${mode} 应合法`)
  }
})

test('accounts 结构校验', () => {
  const r = loadConfig({ whales: [{ id: 'a', accounts: [{ platform: '' }, { platform: 'bilibili' }, 'x'] }] })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /platform 必须是非空/)
})

test('cron 条目必须有 expr 和 action', () => {
  const r = loadConfig({
    whales: [{ id: 'a', rhythm: { cron: [{ expr: '0 9 * * *' }] } }],
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /action 必须是非空/)
})

test('passive 动作枚举校验', () => {
  const r = loadConfig({
    whales: [{ id: 'a', rhythm: { passive: { onMention: 'attack' } } }],
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /onMention/)
})

// ---------- withDefaults ----------

test('默认值填充完整', () => {
  const [whale] = loadConfig({ whales: [{ id: 'lingxi' }] }).whales
  assert.equal(whale.approvalMode, 'semi')
  assert.equal(whale.rhythm.timezone, 'Asia/Shanghai')
  assert.equal(whale.rhythm.passive.onDM, 'read')
  assert.equal(whale.limits.dailyPosts, 10)
  assert.equal(whale.identity.displayName, 'lingxi')
  assert.deepEqual(whale.permissions.allow, [])
  assert.equal(whale.accounts.length, 0)
})

test('显式配置不被默认值覆盖', () => {
  const [whale] = loadConfig({
    whales: [{ id: 'a', approvalMode: 'dry-run', limits: { dailyPosts: 3 } }],
  }).whales
  assert.equal(whale.approvalMode, 'dry-run')
  assert.equal(whale.limits.dailyPosts, 3)
})

// ---------- persona ----------

test('内置模板可被发现且至少两个', async () => {
  const templates = await listTemplates()
  assert.ok(templates.includes('energetic'))
  assert.ok(templates.includes('quiet-observer'))
})

test('空白出生：无模板无自定义', async () => {
  const r = await resolvePersona({})
  assert.equal(r.ok, true)
  assert.equal(r.value.id, 'blank')
  assert.equal(r.value.name, BLANK_PERSONA.name)
})

test('模板人设加载', async () => {
  const r = await resolvePersona({ template: 'energetic' })
  assert.equal(r.ok, true)
  assert.equal(r.value.name, '元气电波系')
  assert.ok(r.value.traits.length > 0)
})

test('custom 覆盖模板同名字段', async () => {
  const r = await resolvePersona({
    template: 'energetic',
    custom: { name: '小鲸', interests: ['天文'] },
  })
  assert.equal(r.value.name, '小鲸')
  assert.deepEqual(r.value.interests, ['天文'])
  assert.equal(r.value.summary, '好奇心旺盛、说话活泼带电波系，像刚上岸的深海少女')
})

test('不存在的模板报错', async () => {
  const r = await resolvePersona({ template: 'nope' })
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在/)
})

// ---------- instance ----------

test('数据目录创建与生命体征', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'whale-life-'))
  try {
    const home = await ensureWhaleDirs('lingxi', tmp)
    assert.ok(existsSync(path.join(home, 'memory')))
    assert.ok(existsSync(path.join(home, 'logs')))
    assert.ok(existsSync(path.join(home, 'identity')))
    assert.ok(existsSync(path.join(dataRoot(tmp), 'secrets')))

    const [whale] = loadConfig({
      whales: [{ id: 'lingxi', persona: { template: 'energetic' }, accounts: [{ platform: 'bilibili' }] }],
    }).whales
    const persona = await resolvePersona(whale.persona)
    const line = vitalsLine(whale, persona.value)
    assert.match(line, /#lingxi「元气电波系」/)
    assert.match(line, /平台:bilibili/)
    assert.match(line, /审批:高危请示/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
