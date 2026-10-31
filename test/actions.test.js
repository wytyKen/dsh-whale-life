// 行动层骨架：审批裁决（纯函数）、action 块解析、执行器（无执行通道时的行为）。
// 以及 schema 的 platforms.dsh 校验。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decideAction, parseActionBlock, createActionExecutor, actionCatalogPrompt, ACTION_CATALOG } from '../src/behavior/actions.js'
import { loadConfig } from '../src/config/schema.js'

// ---------- 审批裁决（骨架态） ----------

test('decideAction：空目录下一切 op 都不在白名单 → 草稿；纪律不随平台消失', () => {
  const d = decideAction({ op: 'anything.publish', approvalMode: 'auto' })
  assert.equal(d.execute, false)
  assert.match(d.reason, /白名单/)
})

test('decideAction：read/write 分级与审批档逻辑（用临时登记的目录项验证）', () => {
  // 直接验证逻辑分支：向目录压入临时项（测试内还原）
  ACTION_CATALOG.push({ op: 'test.read', kind: 'read', desc: '', params: '' })
  ACTION_CATALOG.push({ op: 'test.write', kind: 'write', desc: '', params: '' })
  try {
    assert.equal(decideAction({ op: 'test.read', approvalMode: 'dry-run' }).execute, true)
    assert.equal(decideAction({ op: 'test.write', approvalMode: 'dry-run' }).execute, false)
    assert.equal(decideAction({ op: 'test.write', approvalMode: 'auto' }).execute, true)
    assert.match(decideAction({ op: 'test.write', approvalMode: 'semi' }).reason, /草稿/)
  } finally {
    ACTION_CATALOG.length = 0
  }
})

// ---------- action 块解析 ----------

test('parseActionBlock：提取合法项，坏 JSON 与缺 op 忽略；无块返回空', () => {
  const text = [
    '今天想记录一下心情。',
    '```action',
    '[{"op":"qzone.publish","content":"月色很安静。"},{"content":"我没有 op"}]',
    '```',
    '另外还有个坏块：',
    '```action',
    '{not json',
    '```',
  ].join('\n')
  const actions = parseActionBlock(text)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].op, 'qzone.publish')
  assert.equal(parseActionBlock('没有任何行动的普通回复').length, 0)
})

// ---------- 执行器（骨架态） ----------

test('executor：无执行通道时白名单外行动一律草稿并落盘', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-act-'))
  const ex = createActionExecutor({ getApprovalMode: () => 'auto', outboxDir: dir, log: () => {} })
  const r = await ex.execute('lingxi', { op: 'whatever.do', content: 'x' })
  assert.equal(r.status, 'drafted')
  const files = readdirSync(dir).filter((f) => f.startsWith('act-'))
  assert.equal(files.length, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('actionCatalogPrompt：空目录返回空串（不注入提示）', () => {
  assert.equal(ACTION_CATALOG.length, 0)
  assert.equal(actionCatalogPrompt(), '')
})

// ---------- platforms.dsh 校验 ----------

test('schema：platforms.dsh 布尔校验与默认值', () => {
  const ok1 = loadConfig({ whales: [{ id: 'a' }] })
  assert.equal(ok1.ok, true)
  assert.equal(ok1.whales[0].platforms.dsh, true)

  const ok2 = loadConfig({ whales: [{ id: 'a', platforms: { dsh: false } }] })
  assert.equal(ok2.ok, true)
  assert.equal(ok2.whales[0].platforms.dsh, false)

  const bad = loadConfig({ whales: [{ id: 'a', platforms: { dsh: 'yes' } }] })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join(';'), /dsh/)
})
