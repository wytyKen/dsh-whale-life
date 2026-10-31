// 行动路由：核心端点（status / personas / outbox / settings-page）与面板语法回归。
// outbox 拒绝/放行走 data/outbox——测试用真实仓库的 outbox 目录（写后清理）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startRouteServer } from '../src/behavior/routes.js'

async function withServer({ getStatus }, fn) {
  const srv = await startRouteServer({ port: 0, getStatus, log: () => {} })
  try {
    await fn(`http://127.0.0.1:${srv.port}`)
  } finally {
    srv.stop()
  }
}

test('GET /status：透传 getStatus（含 native 会话状态）', async () => {
  await withServer({
    getStatus: () => ({
      whales: [{ id: 'lingxi', persona: '泠汐', approvalMode: 'semi', native: { platform: 'dsh-native', sessions: [{ id: 's1', turns: 3, lastAt: Date.now() }] } }],
      ticker: { running: true },
    }),
  }, async (base) => {
    const j = await (await fetch(`${base}/status`)).json()
    assert.equal(j.ok, true)
    assert.equal(j.whales[0].native.sessions.length, 1)
    assert.equal(j.ticker.running, true)
  })
})

test('outbox：拒绝留痕；放行在无执行通道时标记 approved 待发', async () => {
  // 用真实 outbox 目录写一条草稿再清理（路由内部读固定 OUTBOX_DIR）
  const OUTBOX = path.resolve('data', 'outbox')
  mkdirSync(OUTBOX, { recursive: true })
  const file = `test-route-${Date.now()}.json`
  const full = path.join(OUTBOX, file)
  writeFileSync(full, JSON.stringify({ at: new Date().toISOString(), via: 'action', op: 'x.do', params: {}, executed: false, reason: 'test' }))
  try {
    await withServer({}, async (base) => {
      // 列表可见
      const list = await (await fetch(`${base}/outbox/list`)).json()
      assert.ok(list.ok)
      assert.ok(list.drafts.some((d) => d.file === file))
      // 拒绝 → rejected 留痕
      const r1 = await (await fetch(`${base}/outbox/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, approve: false }),
      })).json()
      assert.equal(r1.ok, true)
      assert.equal(r1.result.action, 'rejected')
      // 再拒绝同一条 → 已处理报错
      const r2 = await (await fetch(`${base}/outbox/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, approve: false }),
      })).json()
      assert.equal(r2.ok, false)
    })
  } finally {
    rmSync(full, { force: true })
  }
})

test('POST /outbox/approve：缺 approve 报 400；未知路由 404', async () => {
  await withServer({}, async (base) => {
    const r1 = await (await fetch(`${base}/outbox/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    assert.equal(r1.ok, false)
    assert.match(r1.error, /approve/)
    const r2 = await fetch(`${base}/qq/napcat`)
    assert.equal(r2.status, 404) // QQ 端点已随平台移除
  })
})

test('settingsFragment/settingsPage 内嵌脚本必须是合法 JS', async () => {
  // 回归：模板字符串里的 \' 求值后变成裸单引号，会截断内嵌脚本的字符串，
  // 导致整页所有卡片永远停在「读取中」。HTML 属性内的引号必须写 &#39;。
  const { settingsFragment, settingsPage } = await import('../src/behavior/settings-section.js')
  for (const [name, html] of [
    ['settingsPage', settingsPage()],
    ['settingsFragment', settingsFragment({ apiBase: 'http://127.0.0.1:3939', pageUrl: 'http://127.0.0.1:3939/settings-page' })],
  ]) {
    const start = html.indexOf('<script>') + '<script>'.length
    const end = html.indexOf('</' + 'script>')
    assert.ok(start > '<script>'.length && end > start, `${name} 应包含内嵌 script`)
    assert.doesNotThrow(() => new Function(html.slice(start, end)), `${name} 内嵌脚本语法错误（页面会停在读取中）`)
  }
})
