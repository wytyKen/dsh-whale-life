import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signWbi, createBiliClient } from '../src/platforms/bilibili/api.js'
import { parseCookie } from '../src/platforms/bilibili/credentials.js'
import { QrAuth, verifyAccount } from '../src/platforms/bilibili/auth.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ---------- WBI 签名（官方规范测试向量，来自 BAC 文档） ----------

test('WBI 签名匹配已知规范向量', () => {
  const images = {
    img_url: 'https://i.test/7cd084941338484aae1ad9425b84077c.png',
    sub_url: 'https://i.test/4932caff0ff746eab6f01bf08b70ac45.png',
  }
  assert.equal(
    signWbi({ foo: '114', bar: '514', baz: 1919810 }, images, 1702204169000),
    'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee',
  )
  assert.throws(() => signWbi({}, {}), /密钥/)
})

// ---------- 凭据解析 ----------

test('凭据解析：标准输入与带前缀的整段 Cookie', () => {
  const c = parseCookie({
    sessdata: 'SESSDATA=aVeryLongSessdataValue1234567890',
    bili_jct: '0123456789abcdef0123456789abcdef',
    buvid3: 'somebuvid',
  })
  assert.equal(c.sessdata, 'aVeryLongSessdataValue1234567890')
  // 整段 cookie 粘贴
  const c2 = parseCookie({
    sessdata: 'SESSDATA=anotherVeryLongSessdataValue1; other=x; SESSDATA=dup',
    bili_jct: '0123456789abcdef0123456789abcdef',
    buvid3: '',
  })
  assert.equal(c2.sessdata, 'anotherVeryLongSessdataValue1')
})

test('凭据解析拒绝注入与畸形', () => {
  assert.throws(() => parseCookie({ sessdata: 'short', bili_jct: 'xx', buvid3: '' }), /无效/)
  assert.throws(() => parseCookie({
    sessdata: 'a'.repeat(30) + '\r\nSet-Cookie: evil=1',
    bili_jct: '0123456789abcdef0123456789abcdef',
    buvid3: '',
  }), /无效/)
})

// ---------- 扫码登录状态机（假 fetch） ----------

function fakeFetcher(script) {
  const calls = []
  const fetcher = async (url) => {
    calls.push(String(url))
    const step = script.shift()
    if (!step) throw new Error('unexpected request')
    let headers = step.headers ?? { 'content-type': 'application/json' }
    if (Array.isArray(headers['set-cookie'])) {
      // 多条 set-cookie 需逐条 append，才能被 getSetCookie() 还原
      const h = new Headers()
      for (const [k, v] of Object.entries(headers)) {
        if (k === 'set-cookie') continue
        h.set(k, v)
      }
      for (const c of headers['set-cookie']) h.append('set-cookie', c)
      headers = h
    }
    return new Response(step.body, { status: step.status ?? 200, headers })
  }
  return { fetcher, calls }
}

const GOOD_JCT = '0123456789abcdef0123456789abcdef'

test('QrAuth：生成 → 扫码 → 确认 → Set-Cookie 提取 → 保存', async () => {
  const saved = []
  const { fetcher, calls } = fakeFetcher([
    { body: JSON.stringify({ code: 0, data: { url: 'https://passport.bilibili.com/h5-app/passport/login/confirm?x=1', qrcode_key: 'k1' } }) },
    { body: JSON.stringify({ code: 0, data: { code: 86101 } }) },
    { body: JSON.stringify({ code: 0, data: { code: 86090 } }) },
    {
      body: JSON.stringify({ code: 0, data: { code: 0, refresh_token: 'r', timestamp: 1 } }),
      headers: {
        'content-type': 'application/json',
        'set-cookie': [
          `SESSDATA=finalSessdataValue1234567890123; Path=/; HttpOnly`,
          `${GOOD_JCT.slice(0, 8)}=junk; Path=/`,
          `bili_jct=${GOOD_JCT}; Path=/`,
          `buvid3=bv123; Path=/`,
        ],
      },
    },
  ])
  const qr = new QrAuth({ save: async (cred) => { saved.push(cred); return { mid: '42', name: '泠汐的B站号' } }, fetch: fetcher, onRender: async () => 'QR' })
  // 统一量纲的假时钟：start 与 poll 共用
  let t = 1_000_000
  qr.now = () => t
  const session = await qr.start()
  assert.equal(session.status, 'waiting')
  assert.match(calls[0], /qrcode\/generate$/)

  let state
  t += 2100
  state = await qr.poll(session.id) // 第一次真轮询：86101 未扫码
  assert.equal(state.status, 'waiting')
  t += 3000
  state = await qr.poll(session.id) // 86090 已扫码待确认
  assert.equal(state.status, 'scanned')
  t += 3000
  state = await qr.poll(session.id) // 0 确认登录
  assert.equal(state.status, 'success')
  assert.equal(state.account.mid, '42')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].bili_jct, GOOD_JCT)
  assert.equal(saved[0].sessdata, 'finalSessdataValue1234567890123')
})

test('QrAuth：过期码 86038 → expired', async () => {
  const { fetcher } = fakeFetcher([
    { body: JSON.stringify({ code: 0, data: { url: 'https://passport.bilibili.com/x', qrcode_key: 'k2' } }) },
    { body: JSON.stringify({ code: 0, data: { code: 86038 } }) },
  ])
  const qr = new QrAuth({ save: async () => { throw new Error('不应保存') }, fetch: fetcher, onRender: async () => 'QR' })
  const session = await qr.start()
  qr.now = () => Date.now() + 10_000
  const state = await qr.poll(session.id)
  assert.equal(state.status, 'expired')
})

test('verifyAccount：登录态无效时报错', async () => {
  const { fetcher } = fakeFetcher([
    { body: JSON.stringify({ code: 0, data: { isLogin: false } }) },
  ])
  await assert.rejects(
    () => verifyAccount(
      { sessdata: 'a'.repeat(40), bili_jct: GOOD_JCT, buvid3: 'x' },
      { fetch: fetcher },
    ),
    /验证失败/,
  )
})

// ---------- api 客户端（缓存与熔断，假 fetch + 临时目录） ----------

test('apiGet：风控码触发熔断并写状态文件', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-bili-'))
  try {
    const { fetcher } = fakeFetcher([
      { body: JSON.stringify({ code: -412, message: '被风控' }) },
    ])
    const client = createBiliClient({ stateDir: dir, fetch: fetcher })
    const r1 = await client.apiGet('https://api.bilibili.com/x/night/status', {}, { noCache: true })
    assert.match(r1.message, /熔断/)
    const state = client.state()
    assert.equal(state.banned, true)
    assert.ok(state.banMinutesLeft >= 1)
    // 熔断中第二次调用不再发网络（脚本已空，若发请求会炸）
    const r2 = await client.apiGet('https://api.bilibili.com/x/night/status', {}, { noCache: true })
    assert.match(r2.message, /熔断/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('apiGet：缓存命中后不再发网络', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-bili-'))
  try {
    const { fetcher } = fakeFetcher([
      { body: JSON.stringify({ code: 0, data: { mid: 42, name: '泠汐的B站号' } }) },
    ])
    const client = createBiliClient({ stateDir: dir, fetch: fetcher })
    const r1 = await client.apiGet('https://api.bilibili.com/x/space/wbi/acc/info?mid=42', {})
    assert.equal(r1.code, 0)
    const r2 = await client.apiGet('https://api.bilibili.com/x/space/wbi/acc/info?mid=42', {})
    assert.equal(r2._cached, true)
    assert.equal(r2.data.name, '泠汐的B站号')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
