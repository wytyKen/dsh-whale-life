// B站 API 客户端：WBI 签名 + 三样保护（缓存 / 熔断 / 节流）。
// 改编自 dsh-bili-whale（MIT © Alterssss）的 tools/lib/bili-api.mjs，
// 状态文件从 ~/.bili-ai/ 迁到鲸生的 data/bili/ 下。

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// WBI 混淆索引表（B站 全站统一、每日轮换 img/sub key 后据此取前 32 位）
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
const keyOf = (u) => String(u).split('/').at(-1).split('.')[0]

export function signWbi(params, images, now = Date.now()) {
  const raw = keyOf(images?.img_url ?? '') + keyOf(images?.sub_url ?? '')
  if (raw.length !== 64) throw new Error('WBI 签名密钥缺失，请稍后重试或检查登录状态')
  const key = MIXIN.map((i) => raw[i]).join('').slice(0, 32)
  const values = { ...params, wts: Math.floor(now / 1000) }
  delete values.w_rid
  const query = Object.keys(values).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ''))}`)
    .join('&')
  return `${query}&w_rid=${crypto.createHash('md5').update(query + key).digest('hex')}`
}

// ── 三样保护（社区实测：B站 412 是 IP 级限流，换接口救不了）────────────────
//   ① 缓存   静态元信息 24h 只问一次；nav（含 WBI 密钥）10 分钟
//   ② 熔断   412/429/-352/-799/-509/-10403 → 指数退避 5→30 分钟，期间吃陈旧缓存
//   ③ 节流   两次请求至少隔 300ms（贴脸连打正是被限流的典型特征）

const CACHE_TTL_MS = 24 * 3600 * 1000
const NAV_TTL_MS = 10 * 60 * 1000
const CACHEABLE = [
  /^\/x\/web-interface\/(wbi\/)?view$/, // 视频元信息
  /^\/x\/space\/wbi\/acc\/info$/, // 用户信息
]
const BAN_CODES = new Set([-412, -352, -799, -509, -10403])

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
  } catch {}
}

function cacheKey(url, headers) {
  const u = new URL(url)
  if (u.pathname === '/x/web-interface/view') u.pathname = '/x/web-interface/wbi/view'
  const params = [...u.searchParams.entries()]
    .filter(([k]) => k !== 'wts' && k !== 'w_rid')
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
  const h = new Headers(headers)
  const account = crypto.createHash('sha256')
    .update(h.get('cookie') ?? '').update('\0').update(h.get('authorization') ?? '').digest('hex')
  return account + ':' + u.hostname + u.pathname + '?' + new URLSearchParams(params).toString()
}
const cacheable = (url) => {
  const u = new URL(url)
  return u.hostname === 'api.bilibili.com' && CACHEABLE.some((re) => re.test(u.pathname))
}
const isNav = (url) => {
  const u = new URL(url)
  return u.hostname === 'api.bilibili.com' && u.pathname === '/x/web-interface/nav'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 创建绑定到某个数据目录的 API 客户端（每只鲸鱼/每账号一份状态）。 */
export function createBiliClient({ stateDir, fetch: fetcher = globalThis.fetch } = {}) {
  const CACHE_FILE = path.join(stateDir, 'api-cache.json')
  const BAN_FILE = path.join(stateDir, 'api-ban.json')

  let lastRequestAt = 0
  let requestQueue = Promise.resolve()
  async function throttle() {
    const turn = requestQueue.then(async () => {
      const gap = Date.now() - lastRequestAt
      if (gap < 300) await sleep(300 - gap)
      lastRequestAt = Date.now()
    })
    requestQueue = turn.catch(() => {})
    return turn
  }

  function bannedUntil() {
    const b = readJson(BAN_FILE, {})
    return Number(b.until ?? 0) > Date.now() ? Number(b.until) : 0
  }

  const stale = (url) => {
    const hit = readJson(CACHE_FILE, {})[cacheKey(url, {})]
    return hit?.data?.code === 0 && Date.now() - Number(hit.at ?? 0) < 7 * CACHE_TTL_MS
      ? { ...hit.data, _cached: true, _stale: true } : null
  }

  async function apiGet(input, headers = {}, opts = {}) {
    const url = new URL(input)
    const ttl = opts.ttlMs ?? CACHE_TTL_MS
    const noCache = opts.noCache === true
    const key = cacheKey(url.href, headers)
    const canCache = cacheable(url.href) || isNav(url.href)
    const biliHost = url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')

    // ① 熔断中：不打网络
    const banned = biliHost ? bannedUntil() : 0
    if (banned) {
      const mins = Math.max(1, Math.round((banned - Date.now()) / 60000))
      const hit = noCache ? null : stale(url.href)
      if (hit) return hit
      return { code: -412, message: `B站 限流熔断中，约 ${mins} 分钟后自动恢复` }
    }

    // ② 缓存命中
    if (!noCache && canCache) {
      const hit = readJson(CACHE_FILE, {})[key]
      const useTtl = isNav(url.href) ? NAV_TTL_MS : ttl
      if (hit && Date.now() - Number(hit.at ?? 0) < useTtl) return { ...hit.data, _cached: true }
    }

    try {
      // 需要 WBI 签名的路径：先取 nav 拿当日密钥
      const signedPaths = {
        '/x/web-interface/view': '/x/web-interface/wbi/view',
        '/x/player/playurl': '/x/player/wbi/playurl',
        '/x/web-interface/search/type': '/x/web-interface/wbi/search/type',
      }
      if (url.hostname === 'api.bilibili.com' && signedPaths[url.pathname]) {
        const nav = await apiGet('https://api.bilibili.com/x/web-interface/nav', headers, { noCache })
        if (!nav.data?.wbi_img) return { code: -1, message: `WBI 签名不可用：${nav.message || 'nav 未返回密钥'}` }
        url.pathname = signedPaths[url.pathname]
        url.search = signWbi(Object.fromEntries(url.searchParams), nav.data.wbi_img)
      }

      // ③ 节流
      await throttle()

      const response = await fetcher(url.href, { headers, signal: AbortSignal.timeout(30000) })

      // HTTP 412/429：平台级风控 → 熔断（5 分钟起步，指数退避封顶 30 分钟）
      if (biliHost && (response.status === 412 || response.status === 429)) {
        const prev = readJson(BAN_FILE, {})
        const streak = Number(prev.streak ?? 0) + 1
        const mins = Math.min(30, 5 * 2 ** (streak - 1))
        writeJson(BAN_FILE, { until: Date.now() + mins * 60_000, why: `HTTP ${response.status}`, at: new Date().toISOString(), streak })
        const hit = noCache ? null : stale(url.href)
        if (hit) return hit
        return { code: -412, message: `HTTP ${response.status}（B站 风控）—— 已熔断 ${mins} 分钟` }
      }
      if (!response.ok) return { code: -1, message: `HTTP ${response.status}（接口异常，请稍后重试）` }

      const data = await response.json().catch(() => null)
      if (!data || typeof data !== 'object') {
        return { code: -1, message: `非 JSON 响应（HTTP ${response.status}），可能是风控或接口变更` }
      }

      // 接口层风控码：HTTP 200 但 code 为负 → 同样熔断
      if (biliHost && BAN_CODES.has(Number(data.code))) {
        const prev = readJson(BAN_FILE, {})
        const streak = Number(prev.streak ?? 0) + 1
        const mins = Math.min(30, 5 * 2 ** (streak - 1))
        writeJson(BAN_FILE, { until: Date.now() + mins * 60_000, why: `code=${data.code}`, at: new Date().toISOString(), streak })
        return { ...data, message: `${data.message ?? ''}（B站 风控 ${data.code}）—— 已熔断 ${mins} 分钟` }
      }

      // 成功：清退避计数并写缓存
      if (Number(data.code) === 0) {
        const b = readJson(BAN_FILE, {})
        if (b.streak) writeJson(BAN_FILE, { ...b, streak: 0 })
        if (!noCache && canCache) {
          const store = readJson(CACHE_FILE, {})
          store[key] = { at: Date.now(), data }
          const keys = Object.keys(store)
          if (keys.length > 400) {
            keys.sort((a, b2) => Number(store[a].at ?? 0) - Number(store[b2].at ?? 0))
            for (const k of keys.slice(0, keys.length - 400)) delete store[k]
          }
          writeJson(CACHE_FILE, store)
        }
      }
      return data
    } catch (error) {
      return { code: -1, message: error.name === 'TimeoutError' ? '请求超时（30 秒）' : '请求失败（网络异常）' }
    }
  }

  return {
    apiGet,
    state() {
      const ban = readJson(BAN_FILE, {})
      const until = Number(ban.until ?? 0)
      return {
        banned: until > Date.now(),
        banMinutesLeft: until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0,
        banWhy: ban.why ?? null,
        cacheEntries: Object.keys(readJson(CACHE_FILE, {})).length,
      }
    },
  }
}
