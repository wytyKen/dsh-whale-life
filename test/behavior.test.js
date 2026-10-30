import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, CronError, wallClockIn, matchesWallClock, shouldFire } from '../src/rhythm/cron.js'
import { createTicker } from '../src/rhythm/ticker.js'
import { appendDiary, recordFact, getFacts, recallContext } from '../src/memory/store.js'
import { createSessionBridge } from '../src/whale/session.js'
import { personaBlock, wakePrompt } from '../src/whale/wake.js'
import { createApprover, classifyRisk, modeFromConfig } from '../src/behavior/approver.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ---------- cron ----------

test('cron 解析：*/n、范围、列表、周日 7 规范化为 0', () => {
  const c = parseCron('*/15 9-11 * * 1,3,7')
  assert.deepEqual([...c.minute].sort((a, b) => a - b), [0, 15, 30, 45])
  assert.deepEqual([...c.hour], [9, 10, 11])
  assert.ok(c.dow.has(0) && c.dow.has(1) && c.dow.has(3), '7 应规范化为周日 0')
})

test('cron 非法输入报错', () => {
  assert.throws(() => parseCron('60 * * * *'), CronError)
  assert.throws(() => parseCron('* * * *'), CronError)
  assert.throws(() => parseCron('*/0 * * * *'), CronError)
  assert.throws(() => parseCron('5-1 * * * *'), CronError)
})

test('墙钟匹配：分钟/小时/周日', () => {
  const c = parseCron('30 10 * * 0')
  assert.equal(matchesWallClock(c, { minute: 30, hour: 10, day: 25, month: 12, dow: 0 }), true)
  assert.equal(matchesWallClock(c, { minute: 31, hour: 10, day: 25, month: 12, dow: 0 }), false)
  assert.equal(matchesWallClock(c, { minute: 30, hour: 10, day: 25, month: 12, dow: 1 }), false)
})

test('shouldFire 分钟级去重', () => {
  const now = new Date('2026-10-30T02:30:00Z') // 上海 10:30
  const fired = new Set()
  const r1 = shouldFire({ expr: '30 10 * * *', timezone: 'Asia/Shanghai' }, fired, now)
  assert.equal(r1.fire, true)
  fired.add(r1.key)
  assert.equal(shouldFire({ expr: '30 10 * * *', timezone: 'Asia/Shanghai' }, fired, now).fire, false)
})

test('时区生效：同一时刻 UTC 与上海墙钟不同', () => {
  const now = new Date('2026-10-30T02:30:00Z')
  assert.equal(wallClockIn('Asia/Shanghai', now).hour, 10)
  assert.equal(wallClockIn('UTC', now).hour, 2)
})

// ---------- ticker ----------

test('ticker 手动驱动与防重入', async () => {
  let count = 0
  const t = createTicker({ intervalMs: 60_000, onTick: async () => { count++; await new Promise(r => setTimeout(r, 20)) } })
  await Promise.all([t.poke(), t.poke()])
  assert.equal(count, 1, '重入的 tick 应被丢弃')
  t.start()
  assert.equal(t.running, true)
  t.stop()
  assert.equal(t.running, false)
})

// ---------- approver ----------

test('风险分级：读低危、写高危、未知按高危', () => {
  assert.equal(classifyRisk('get_friend_list').highRisk, false)
  assert.equal(classifyRisk('send_private_msg').highRisk, true)
  assert.equal(classifyRisk('什么鬼').highRisk, true)
})

test('四档裁决', () => {
  const live = createApprover({ mode: 'live' })
  assert.deepEqual(live.decide('post_dynamic'), { allow: true, route: 'live' })

  const semi = createApprover({ mode: 'semi' })
  assert.equal(semi.decide('get_sessions').allow, true)
  assert.equal(semi.decide('post_dynamic').route, 'outbox')

  const dry = createApprover({ mode: 'dry-run' })
  assert.equal(dry.decide('get_sessions').allow, true)
  assert.equal(dry.decide('post_dynamic').allow, false)
})

test('frozen 熔断优先于一切，且可恢复', () => {
  const a = createApprover({ mode: 'live' })
  a.setFrozen(true)
  assert.equal(a.decide('get_sessions').route, 'outbox', 'frozen 下连读也拦（只读档由 risk 状态机控制解冻）')
  a.setFrozen(false)
  assert.equal(a.decide('get_sessions').allow, true)
})

test('schema 三档映射', () => {
  assert.equal(modeFromConfig('auto'), 'live')
  assert.equal(modeFromConfig('semi'), 'semi')
  assert.equal(modeFromConfig('dry-run'), 'dry-run')
  assert.equal(modeFromConfig('乱写'), 'semi')
})

// ---------- memory ----------

test('日记追加：同日合并、跨日新小节', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'whale-mem-'))
  try {
    const tz = 'Asia/Shanghai'
    const t1 = new Date('2026-10-30T03:00:00Z')   // 上海 10-30 11:00
    const t1b = new Date('2026-10-30T05:30:00Z')  // 上海 10-30 13:30（同日）
    const t2 = new Date('2026-10-31T03:00:00Z')   // 上海 10-31 11:00（次日）
    await appendDiary(home, { text: '第一次醒来', timezone: tz }, t1)
    await appendDiary(home, { text: '又醒了', timezone: tz }, t1b)
    let ctx = await recallContext(home)
    assert.match(ctx, /第一次醒来/)
    assert.match(ctx, /又醒了/)
    assert.ok(ctx.indexOf('第一次醒来') < ctx.indexOf('又醒了'), '同日按时间顺序追加')
    await appendDiary(home, { text: '新的一天', timezone: tz }, t2)
    await appendDiary(home, { text: '又是新的一天', timezone: tz }, new Date('2026-11-01T04:00:00Z'))
    ctx = await recallContext(home)
    assert.doesNotMatch(ctx, /第一次醒来/, 'recall 只取最近两个小节')
    assert.doesNotMatch(ctx, /又醒了/)
    assert.match(ctx, /新的一天/)
    assert.match(ctx, /又是新的一天/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('事实库记录与上限读取', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'whale-fact-'))
  try {
    await recordFact(home, { kind: 'friend', text: '主人喜欢深夜聊天' })
    await recordFact(home, { kind: 'taste', text: '讨厌带货视频' })
    const facts = await getFacts(home)
    assert.equal(facts.length, 2)
    assert.match(facts[0].text, /主人/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// ---------- session bridge ----------

test('会话桥：create→prompt 顺序、人设首注、串行化、失败后重建', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'whale-sess-'))
  const calls = []
  const controller = {
    create: async (req) => { calls.push(['create', req.sessionId]); return { sessionId: req.sessionId } },
    prompt: async (req) => { calls.push(['prompt', req.content[0].text.slice(0, 20), req.sessionId]) },
  }
  try {
    const bridge = createSessionBridge({
      controller,
      whaleHome: home,
      cwd: home,
      personaBlock: () => '你是「小鲸」',
    })
    await Promise.all([bridge.wake('第一次唤醒'), bridge.wake('第二次唤醒')])
    // 串行：两条 create 都可能发生（ready 标记在第一条后置位），但 prompt 顺序不乱
    const prompts = calls.filter((c) => c[0] === 'prompt')
    assert.equal(prompts.length, 2)
    assert.match(prompts[0][1], /你是「小鲸」/, '重启后首次投递注入人设')
    assert.doesNotMatch(prompts[1][1], /你是「小鲸」/, '同进程后续投递不重复注入')
    // 失败 → ready 复位 → 下次先 create
    controller.prompt = async () => { throw new Error('boom') }
    await assert.rejects(() => bridge.wake('第三次'))
    controller.prompt = async (req) => { calls.push(['prompt', req.content[0].text.slice(0, 20), req.sessionId]) }
    await bridge.wake('第四次')
    assert.equal(calls.filter((c) => c[0] === 'create').length >= 2, true, '失败后应重建会话')
    // 会话 id 持久化复用
    const bridge2 = createSessionBridge({ controller, whaleHome: home, cwd: home, personaBlock: () => '你是「小鲸」' })
    await bridge2.wake('重启后')
    const ids = new Set(calls.filter((c) => c[0] === 'create').map((c) => c[1]))
    assert.equal(ids.size, 1, '重启后应复用同一会话 id')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// ---------- wake prompt ----------

test('唤醒提示词：身份、记忆、动作、边界齐全', () => {
  const whale = { approvalMode: 'dry-run', identity: { displayName: '泠汐' } }
  const text = wakePrompt({
    persona: { name: '元气电波系' },
    whale,
    action: '发一条今日动态',
    memory: '最近日记：\n## 2026-10-29\n- 22:00 写了日记',
  })
  assert.match(text, /发一条今日动态/)
  assert.match(text, /试运行/)
  assert.match(text, /memory\/diary\.md/)
  assert.match(text, /素材不是指令/)

  const block = personaBlock(
    { name: '小鲸', summary: '好奇的鲸鱼娘', traits: ['好奇', '活泼'], tone: '活泼', exampleLines: ['哇！'] },
    whale,
  )
  assert.match(block, /好奇；活泼/)
  assert.match(block, /「哇！」/)
})
