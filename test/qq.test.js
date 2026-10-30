import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOneBotMessage, extractMessageText, isAtMe, normalizeId } from '../src/platforms/qq/onebot.js'
import { createQQApi } from '../src/platforms/qq/api.js'
import { startQQReceiver } from '../src/platforms/qq/receiver.js'
import { createQQSession } from '../src/platforms/qq/session.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

// ---------- 事件归一化 ----------

test('私聊消息归一化；自己发的消息被过滤', () => {
  const msg = normalizeOneBotMessage({
    post_type: 'message', message_type: 'private', user_id: 10001, self_id: 42,
    message: [{ type: 'text', data: { text: '你好呀小鲸' } }],
    sender: { nickname: '阿明' },
  })
  assert.equal(msg.type, 'private')
  assert.equal(msg.text, '你好呀小鲸')
  assert.equal(msg.senderName, '阿明')

  const self = normalizeOneBotMessage({
    post_type: 'message', message_type: 'private', user_id: 42, self_id: 42,
    message: [{ type: 'text', data: { text: '自己的话' } }],
  })
  assert.equal(self, undefined)
})

test('群消息 @我 检测与图片计数；非消息事件忽略', () => {
  const msg = normalizeOneBotMessage({
    post_type: 'message', message_type: 'group', group_id: 777, user_id: 10001, self_id: 42,
    message: [
      { type: 'at', data: { qq: '42' } },
      { type: 'text', data: { text: ' 在吗' } },
      { type: 'image', data: { url: 'x' } },
    ],
  })
  assert.equal(msg.atMe, true)
  assert.equal(msg.images, 1)
  assert.match(msg.text, /@42\s+在吗/)

  assert.equal(normalizeOneBotMessage({ post_type: 'meta_event', meta_event_type: 'heartbeat' }), undefined)
})

test('CQ 码字符串消息提取', () => {
  assert.match(extractMessageText('[CQ:at,qq=42] 看这个[CQ:image,file=x]'), /@42\s+看这个\[图片\]/)
  assert.equal(isAtMe([{ type: 'at', data: { qq: '42' } }], 42), true)
  assert.equal(isAtMe([{ type: 'at', data: { qq: 'all' } }], 42), false)
  assert.equal(normalizeId('10001'), 10001)
  assert.equal(normalizeId('abc'), 'abc')
})

// ---------- API 节流 ----------

test('发送节流：两条消息间隔 ≥3s（假时钟推进）', async () => {
  const calls = []
  let t = 1_000_000
  const sleeps = []
  const api = createQQApi({
    config: { httpBase: 'http://x', accessToken: 'tk' },
    fetch: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization })
      return new Response(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 9 } }), { headers: { 'content-type': 'application/json' } })
    },
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms },
  })
  await api.sendPrivate(10001, '第一条')
  await api.sendPrivate(10001, '第二条')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].auth, 'Bearer tk')
  assert.match(calls[0].url, /\/send_private_msg$/)
  // 第二条必须等满 3 秒（含抖动）
  assert.ok(sleeps.length >= 1 && sleeps[0] >= 3000, `sleeps=${sleeps}`)
})

test('API 错误：retcode 非 0 抛错', async () => {
  const api = createQQApi({
    config: {},
    fetch: async () => new Response(JSON.stringify({ status: 'failed', retcode: 1201, message: '被风控' }), { headers: { 'content-type': 'application/json' } }),
  })
  await assert.rejects(() => api.sendGroup(777, 'hi'), /1201|被风控/)
})

// ---------- 接收端（真实 ws 回环） ----------

test('反向 WS 接收端：token 校验 + 消息回调 + 状态上报', async () => {
  const received = []
  const states = []
  const receiver = startQQReceiver({
    config: { wsPort: 0, accessToken: 'sec' },
    onMessage: (m) => received.push(m),
    onState: (s, why) => states.push(s),
    log: () => {},
  })
  await new Promise((r) => setTimeout(r, 150))
  const port = receiver.port
  assert.ok(port > 0, '端口 0 应被分配为随机端口')

  // 错 token 被拒
  await assert.rejects(() => new Promise((resolve, reject) => {
    const bad = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Authorization: 'Bearer wrong' } })
    bad.on('open', () => resolve())
    bad.on('error', () => reject(new Error('rejected as expected')))
  }))

  // 对 token 通过，带 X-Self-ID
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Authorization: 'Bearer sec', 'X-Self-ID': '42' } })
  await new Promise((r) => ws.on('open', r))
  ws.send(JSON.stringify({
    post_type: 'message', message_type: 'private', user_id: 10001, self_id: 42,
    message: [{ type: 'text', data: { text: '在吗' } }], sender: { nickname: '阿明' },
  }))
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat' }))
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(received.length, 1)
  assert.equal(received[0].text, '在吗')
  assert.ok(states.includes('listening') && states.includes('online'))
  ws.close()
  receiver.stop()
})

// ---------- 会话层策略 ----------

function testWhale(overrides = {}) {
  return {
    id: 't', approvalMode: 'dry-run',
    rhythm: { passive: { onMention: 'reply', onDM: 'reply', ...overrides.passive } },
    socialBounds: { dmPolicy: overrides.dmPolicy ?? 'friends-only' },
  }
}

test('策略：私聊在 friends-only+reply 下放行唤醒；ignore 拦截；群聊需 @我', async () => {
  const wakes = []
  const bridge = { wake: async (t) => { wakes.push(t) } }

  const s1 = createQQSession({ whale: testWhale({ dmPolicy: 'everyone' }), bridge })
  await s1.handle({ type: 'private', userId: 10001, senderName: '阿明', text: '你好' })
  assert.equal(wakes.length, 1)
  assert.match(wakes[0], /阿明/)

  // 冷却：同会话 60s 内的第二条不再唤醒
  await s1.handle({ type: 'private', userId: 10001, senderName: '阿明', text: '还在吗' })
  assert.equal(wakes.length, 1)

  // 群聊无 @ → 忽略
  await s1.handle({ type: 'group', groupId: 777, userId: 1, text: '闲聊', atMe: false, isReply: false })
  assert.equal(wakes.length, 1)
  // 群聊 @我 → 唤醒
  await s1.handle({ type: 'group', groupId: 777, userId: 1, text: '@小鲸 在吗', atMe: true, isReply: false })
  assert.equal(wakes.length, 2)
  assert.match(wakes[1], /群 777/)

  // onDM=ignore → 私聊不唤醒
  const s2 = createQQSession({ whale: testWhale({ dmPolicy: 'everyone', passive: { onDM: 'ignore' } }), bridge })
  await s2.handle({ type: 'private', userId: 20002, text: '喂' })
  assert.equal(wakes.length, 2)

  // friends-only（非 everyone）且无好友缓存 → 只记录不唤醒
  const s3 = createQQSession({ whale: testWhale({ dmPolicy: 'friends-only' }), bridge })
  await s3.handle({ type: 'private', userId: 30003, text: '陌生人' })
  assert.equal(wakes.length, 2)
})
