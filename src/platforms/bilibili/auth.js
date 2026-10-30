// B站扫码登录：QR 生成 → 轮询 → Set-Cookie 提取 → 凭据落盘。
// 改编自 dsh-bili-whale（MIT © Alterssss）：状态机与安全检查原样保留，
// 渲染改为「终端 ASCII 码 + PNG 文件」双输出（无 Web UI 依赖）。

import crypto from 'node:crypto'
import QRCode from 'qrcode'
import { AuthError, parseCookie } from './credentials.js'

const PASSPORT = 'https://passport.bilibili.com'
const INTERVAL = 2000
const TTL = 180000
const terminal = new Set(['success', 'expired', 'cancelled', 'error'])

async function request(fetcher, url, { signal, credentials } = {}) {
  try {
    const response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      headers: {
        'user-agent': 'Mozilla/5.0', referer: PASSPORT + '/login',
        ...(credentials
          ? { cookie: `SESSDATA=${credentials.sessdata}; bili_jct=${credentials.bili_jct}${credentials.buvid3 ? '; buvid3=' + credentials.buvid3 : ''}` }
          : {}),
      },
    })
    if (!response.ok) throw Error()
    const body = await response.json()
    if (body.code !== 0) throw Error()
    return { data: body.data, response }
  } catch {
    throw new AuthError(signal?.aborted ? '登录已取消。' : 'B 站登录请求失败，请稍后重试。')
  }
}

/** 验证凭据有效性，返回 { mid, name }（名字中出现的凭据值会被打码）。 */
export async function verifyAccount(input, { fetch: fetcher = globalThis.fetch, signal } = {}) {
  const credentials = parseCookie(input)
  const { data } = await request(fetcher, 'https://api.bilibili.com/x/web-interface/nav', { credentials, signal })
  if (data?.isLogin !== true || !/^[1-9]\d{0,19}$/.test(String(data?.mid ?? ''))) {
    throw new AuthError('登录验证失败。')
  }
  let name = typeof data.uname === 'string' ? data.uname.slice(0, 200) : ''
  for (const secret of Object.values(credentials)) if (secret) name = name.split(secret).join('[redacted]')
  return { mid: String(data.mid), name }
}

/** 一次一个短时会话；二维码内容与密钥绝不落日志。 */
export class QrAuth {
  constructor({ save, fetch: fetcher = globalThis.fetch, now = Date.now, onRender } = {}) {
    this.save = save
    this.fetch = fetcher
    this.now = now
    // onRender(url)：把登录 URL 交给展示层（终端 ASCII + PNG 文件）
    this.render = onRender ?? ((url) => {
      const safe = QRCode.toString(url, { type: 'terminal', small: true })
      return Promise.resolve(safe)
    })
    this.current = null
    this.nextStart = 0
    this.disposed = false
  }

  state(session) {
    return {
      id: session.id, status: session.status, expiresAt: session.expiresAt,
      ...(session.account ? { account: session.account } : {}),
      ...(session.error ? { error: session.error } : {}),
    }
  }

  check(session) {
    if (this.disposed || this.current !== session || session.controller.signal.aborted) {
      throw new AuthError('登录流程已失效，请重新扫码。')
    }
    if (this.now() >= session.expiresAt) { session.status = 'expired'; throw new AuthError('二维码已过期，请重新生成。') }
  }

  async start() {
    if (this.disposed) throw new AuthError('登录服务已关闭。')
    if (this.now() < this.nextStart) throw new AuthError('请稍等两秒后再生成二维码。')
    this.nextStart = this.now() + INTERVAL
    this.cancel()
    const session = {
      id: crypto.randomUUID(), status: 'waiting',
      controller: new AbortController(), expiresAt: this.now() + TTL, nextPoll: this.now() + INTERVAL,
    }
    this.current = session
    try {
      const { data } = await request(this.fetch, PASSPORT + '/x/passport-login/web/qrcode/generate', { signal: session.controller.signal })
      this.check(session)
      let url
      try { url = new URL(data?.url) } catch { throw new AuthError('二维码响应无效，请稍后重试。') }
      if (![PASSPORT, 'https://account.bilibili.com'].includes(url.origin) || url.username || url.password
        || typeof data?.qrcode_key !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(data.qrcode_key)) {
        throw new AuthError('二维码响应无效，请稍后重试。')
      }
      session.key = data.qrcode_key
      session.display = await this.render(url.href)
      this.check(session)
      return this.state(session)
    } catch (error) {
      session.status = session.controller.signal.aborted ? 'cancelled' : 'error'
      delete session.key
      throw error instanceof AuthError ? error : new AuthError('二维码生成失败，请重试。')
    }
  }

  async poll(id) {
    const session = this.current
    if (!session || session.id !== id) throw new AuthError('登录流程已失效，请重新扫码。')
    if (terminal.has(session.status)) return this.state(session)
    if (this.now() >= session.expiresAt) {
      session.status = 'expired'; session.controller.abort()
      return this.state(session)
    }
    if (session.flight) return session.flight
    if (this.now() < session.nextPoll) return this.state(session)
    session.nextPoll = this.now() + INTERVAL
    session.flight = this.pollOnce(session).finally(() => { session.flight = null })
    return session.flight
  }

  async pollOnce(session) {
    try {
      const url = new URL('/x/passport-login/web/qrcode/poll', PASSPORT)
      url.searchParams.set('qrcode_key', session.key)
      const { data, response } = await request(this.fetch, url, { signal: session.controller.signal })
      this.check(session)
      if (data?.code === 86101) session.status = 'waiting'
      else if (data?.code === 86090) session.status = 'scanned'
      else if (data?.code === 86038) session.status = 'expired'
      else if (data?.code === 0) {
        const values = {}
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';', 1)[0], split = pair.indexOf('=')
          const name = pair.slice(0, split).trim()
          if (['SESSDATA', 'bili_jct', 'buvid3'].includes(name)) values[name] = pair.slice(split + 1).trim()
        }
        const credentials = parseCookie({
          sessdata: values.SESSDATA, bili_jct: values.bili_jct, buvid3: values.buvid3,
        })
        session.account = await this.save(credentials, { signal: session.controller.signal })
        session.status = 'success'
      } else throw new AuthError('无法识别登录状态，请重新扫码。')
    } catch (error) {
      if (!terminal.has(session.status)) {
        session.status = session.controller.signal.aborted ? 'cancelled' : 'error'
        session.error = error instanceof AuthError ? error.message : '登录未保存，请重新扫码。'
      }
    }
    return this.state(session)
  }

  cancel(id) {
    const session = this.current
    if (!session || (id && session.id !== id)) return { status: 'cancelled' }
    if (!terminal.has(session.status)) session.status = 'cancelled'
    session.controller.abort()
    return this.state(session)
  }

  dispose() { this.disposed = true; this.cancel() }
}
