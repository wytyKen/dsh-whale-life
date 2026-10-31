// 行动层：审批裁决（纯函数）、action 块解析、执行器（假 QQ）。
// 以及 schema 的 per-whale QQ 平台配置校验。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decideAction, parseActionBlock, createActionExecutor, ACTION_CATALOG } from '../src/behavior/actions.js'
import { loadConfig } from '../src/config/schema.js'

// ---------- 审批裁决 ----------

test('decideAction：只读免审；写操作按审批档；白名单外一律草稿', () => {
  assert.deepEqual(decideAction({ op: 'qzone.read', approvalMode: 'dry-run' }), { execute: true, reason: '只读行动免审' })
  assert.equal(decideAction({ op: 'qzone.publish', approvalMode: 'dry-run' }).execute, false)
  assert.equal(decideAction({ op: 'qzone.publish', approvalMode: 'auto' }).execute, true)
  const semi = decideAction({ op: 'qzone.publish', approvalMode: 'semi' })
  assert.equal(semi.execute, false)
  assert.match(semi.reason, /草稿/)
  const unknown = decideAction({ op: 'set_group_kick', approvalMode: 'auto' })
  assert.equal(unknown.execute, false)
  assert.match(unknown.reason, /白名单/)
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

// ---------- 执行器 ----------

test('executor：semi 下 publish 存草稿；auto 下直发并留痕；QQ 缺席报错', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-act-'))
  const calls = []
  const fakeQQ = {
    whale: { id: 'lingxi', approvalMode: 'auto' },
    api: { call: async (action, params) => { calls.push([action, params]); return { tid: 't123' } } },
  }
  const getQQ = (whaleId) => (whaleId === 'lingxi' ? fakeQQ : null)
  const ex = createActionExecutor({ getQQ, outboxDir: dir, log: () => {} })

  // auto：直发 + 留痕文件
  const r1 = await ex.execute('lingxi', { op: 'qzone.publish', content: '第一缕晨光。', visibility: 4 })
  assert.equal(r1.status, 'executed')
  assert.deepEqual(calls[0], ['send_qzone_msg', { content: '第一缕晨光。', ugc_right: 4 }])

  // semi 鲸：草稿
  const semiQQ = { ...fakeQQ, whale: { id: 'semi-whale', approvalMode: 'semi' } }
  const ex2 = createActionExecutor({
    getQQ: (id) => (id === 'semi-whale' ? semiQQ : id === 'lingxi' ? fakeQQ : null),
    outboxDir: dir, log: () => {},
  })
  const r2 = await ex2.execute('semi-whale', { op: 'qzone.publish', content: '悄悄话' })
  assert.equal(r2.status, 'drafted')

  // QQ 缺席的鲸：读不到审批档（默认 semi）→ 也是草稿（不执行）
  const r3 = await ex2.execute('ghost', { op: 'qzone.publish', content: 'x' })
  assert.equal(r3.status, 'drafted')

  // 留痕文件存在（executed + drafted 各一）
  const files = readdirSync(dir).filter((f) => f.startsWith('act-'))
  assert.ok(files.length >= 2)
  rmSync(dir, { recursive: true, force: true })
})

test('executor：只读 qzone.read 在 dry-run 下也直接执行', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-act-'))
  const fakeQQ = {
    whale: { id: 'w', approvalMode: 'dry-run' },
    api: { call: async () => ({ feeds: [] }) },
  }
  const ex = createActionExecutor({ getQQ: () => fakeQQ, outboxDir: dir, log: () => {} })
  const r = await ex.execute('w', { op: 'qzone.read' })
  assert.equal(r.status, 'executed')
  rmSync(dir, { recursive: true, force: true })
})

// ---------- per-whale QQ 平台配置 ----------

test('schema：platforms.qq 支持 true / 对象；对象字段规范化；非法值报错', () => {
  const ok1 = loadConfig({ whales: [{ id: 'a', platforms: { qq: true } }] })
  assert.equal(ok1.ok, true)
  assert.deepEqual(ok1.whales[0].platforms.qq, {})

  const ok2 = loadConfig({ whales: [{ id: 'a', platforms: { qq: { selfId: 12345, wsPort: '3005', autoBoot: false } } }] })
  assert.equal(ok2.ok, true)
  assert.deepEqual(ok2.whales[0].platforms.qq, { selfId: '12345', wsPort: 3005, autoBoot: false })

  const ok3 = loadConfig({ whales: [{ id: 'a', platforms: { qq: null } }] })
  assert.equal(ok3.ok, true)
  assert.equal(ok3.whales[0].platforms.qq, null)

  const bad = loadConfig({ whales: [{ id: 'a', platforms: { qq: { wsPort: 'abc' } } }] })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join(';'), /wsPort/)

  const bad2 = loadConfig({ whales: [{ id: 'a', platforms: { qq: 'yes' } }] })
  assert.equal(bad2.ok, false)
  assert.match(bad2.errors.join(';'), /true 或对象/)
})

// ---------- 能力目录完整性 ----------

test('ACTION_CATALOG：每个 op 都在审批白名单内', () => {
  for (const a of ACTION_CATALOG) {
    const d = decideAction({ op: a.op, approvalMode: 'auto' })
    assert.ok(!/白名单/.test(d.reason ?? ''), `${a.op} 应在白名单内：${d.reason}`)
  }
})
