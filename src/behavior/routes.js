// 插件专属行动路由服务器：独立 HTTP 服务（默认 127.0.0.1:3939），
// 不经过 DSH webServer 的信任门——她的会话只需一次普通 localhost fetch。
// 审批档、≥3s 节流、outbox 留痕全部在本模块（插件进程内）强制执行——
// 会话侧零特权，纪律不可被提示词绕过。
//
// 路由：
//   GET  /status         她的生命体征与 QQ 接收端状态
//   POST /qq/send        { whale?, to, text }  回复 QQ 私聊/群
//   GET  /personas       人设模板清单（设置页下拉用）
//   GET  /outbox/list    待审草稿清单
//   POST /outbox/approve { file, approve }  放行（真发）/ 拒绝（留痕）
//   GET  /peers          她的活跃 QQ 会话（peerKey → 名字/最近消息/最后活跃）
//   GET  /settings-page  独立管理面板（完整 HTML，同源 fetch 上述 API）
//   GET  /qq/napcat      NapCat 进程状态 + 登录二维码状态（设置页控制台用）
//   POST /qq/napcat/start    启动 NapCat（快速登录；已在跑则 no-op）
//   POST /qq/napcat/restart  重启登录流程（杀掉重来 = 拿一张新二维码）
//   GET  /qq/qrcode      登录二维码 PNG（前端内嵌显示；no-store 防缓存）
//   POST /qq/autoboot    { enabled }  DSH 启动时自动拉起 NapCat 的开关

import http from 'node:http'
import path from 'node:path'
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { listPersonas } from '../config/persona.js'
import { settingsPage } from './settings-section.js'
import { createNapCatBoot } from '../platforms/qq/boot.js'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTBOX_DIR = path.join(PLUGIN_ROOT, 'data', 'outbox')
const QQ_CONFIG_FILE = path.join(PLUGIN_ROOT, 'data', 'secrets', 'qq.json')
const REPLY_WINDOW_MS = 30 * 60 * 1000 // semi 档：仅允许回复 30 分钟内主动来找过她的人
const OUTBOX_LIST_LIMIT = 50   // 待审清单最多返回 50 条
const PEERS_LIMIT = 20         // 会话列表最多 20 个
const PEERS_PREVIEW_COUNT = 6  // 最多给 6 个私聊会话拉「最近消息预览」（NapCat 历史，best-effort）
const PEERS_PREVIEW_LEN = 60

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function isLoopback(req) {
  const addr = String(req.socket?.remoteAddress ?? '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === '::ffff:0:1'
}

async function readJsonBody(req, limit = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 发送裁决（纯函数，可测）：
 * dry-run → 一律草稿；auto → 直发；semi → 仅当对方在回复窗口内主动来过（「她只能回话，不能主动搭讪」）
 */
export function decideSend({ approvalMode, lastInboundAt, now = Date.now() }) {
  if (approvalMode === 'dry-run') {
    return { execute: false, reason: 'dry-run：只记录不发布' }
  }
  if (approvalMode === 'auto') {
    return { execute: true, reason: 'auto：自主档直发（仍受节流与留痕约束）' }
  }
  if (lastInboundAt && now - lastInboundAt <= REPLY_WINDOW_MS) {
    return { execute: true, reason: 'semi：对方在回复窗口内来过，允许回话' }
  }
  return { execute: false, reason: 'semi：对方近期未来信，只能存草稿（她可以回话，不能主动搭讪）' }
}

function isLoopbackOrigin(origin) {
  try {
    const { hostname } = new URL(origin)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

// OneBot 消息段 → 一行预览文本（与 session.js 的 extractHistoryText 同语义的精简版）
function extractPreview(message) {
  if (typeof message === 'string') return message.replace(/\[CQ:[^\]]*\]/g, '[表情]').trim()
  if (Array.isArray(message)) {
    return message.map((s) => {
      if (s?.type === 'text') return s.data?.text ?? ''
      if (s?.type === 'image') return '[图片]'
      if (s?.type === 'at') return `@${s.data?.qq ?? ''} `
      return ''
    }).join('').trim()
  }
  return ''
}

// ── Outbox：待审草稿清单（executed=false 且未拒绝，旧→新）─────────────────
async function listOutboxDrafts(limit = OUTBOX_LIST_LIMIT) {
  let files = []
  try {
    files = (await readdir(OUTBOX_DIR)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return [] // 目录不存在 = 队列为空
  }
  const drafts = []
  for (let i = files.length - 1; i >= 0 && drafts.length < limit; i -= 1) {
    try {
      const rec = JSON.parse(await readFile(path.join(OUTBOX_DIR, files[i]), 'utf8'))
      if (rec && rec.executed === false && !rec.rejected) {
        drafts.push({
          file: files[i],
          at: rec.at ?? null,
          to: rec.to ?? '',
          text: rec.text ?? '',
          reason: rec.reason ?? '',
        })
      }
    } catch { /* 单个坏文件跳过，不拖垮整个清单 */ }
  }
  return drafts.reverse()
}

// ── Outbox：主人裁决。放行 = 真发一次（主人显式决策，不再过 decideSend）；
//            拒绝 = 标记 rejected 留痕（她会从否决记录里学到「这种不要」）。
//            返回 { error } 表示业务失败（不抛异常），草稿原样保留。
async function approveOutboxDraft({ file, approve, getQQ, log }) {
  if (typeof file !== 'string' || !/^[\w.-]+\.json$/.test(file) || path.basename(file) !== file) {
    return { error: 'file 必须是 outbox 目录内的文件名' }
  }
  const full = path.join(OUTBOX_DIR, file)
  let record
  try {
    record = JSON.parse(await readFile(full, 'utf8'))
  } catch {
    return { error: '草稿不存在（可能已被处理）' }
  }
  if (record.executed === true) return { error: '这条草稿已经发出过了' }
  if (record.rejected) return { error: '这条草稿已被拒绝' }
  if (!record.to || !record.text) return { error: '草稿缺少 to/text，无法执行' }

  if (approve === false) {
    const next = { ...record, rejected: true, rejectedAt: new Date().toISOString(), rejectedBy: 'owner' }
    await writeFile(full, JSON.stringify(next, null, 2) + '\n')
    log(`草稿 ${file} 已被主人拒绝（留痕）`)
    return { action: 'rejected', file, to: record.to }
  }

  const qq = getQQ?.()
  if (!qq) return { error: '没有已就绪的 QQ 平台（先配置账号并启动）' }
  try {
    const isGroup = String(record.to).startsWith('group:')
    const peer = isGroup ? String(record.to).slice(6) : String(record.to)
    const r = isGroup ? await qq.api.sendGroup(peer, String(record.text)) : await qq.api.sendPrivate(peer, String(record.text))
    const next = {
      ...record, executed: true, executedAt: new Date().toISOString(),
      approvedBy: 'owner', messageId: r?.message_id ?? null,
    }
    await writeFile(full, JSON.stringify(next, null, 2) + '\n')
    log(`草稿 ${file} 已放行 → ${record.to}（messageId=${r?.message_id}）`)
    return { action: 'sent', file, to: record.to, messageId: r?.message_id ?? null }
  } catch (e) {
    return { error: `放行失败（草稿保留待重试）：${e?.message ?? e}` }
  }
}

// ── Peers：活跃 QQ 会话。名字来自持久化的 qq-peers.json（data/<whale-id>/），
//            活跃时间取「持久化 lastAt」与内存 recentPeers 的较大值；
//            最近消息预览 best-effort 拉 NapCat 历史（拉不到就空，不阻塞）。
async function listPeers({ getAllQQ }) {
  const entries = typeof getAllQQ === 'function' ? (getAllQQ() ?? []) : []
  const byKey = new Map()
  for (const entry of entries) {
    const whaleId = entry?.whale?.id
    if (!whaleId) continue
    let store = {}
    // 会话名持久化文件：优先注册表带来的权威路径，兜底经典布局 data/<id>/qq-peers.json
    const peersFile = entry.peersFile || path.join(PLUGIN_ROOT, 'data', whaleId, 'qq-peers.json')
    try {
      store = JSON.parse(await readFile(peersFile, 'utf8'))
    } catch { /* 没有持久化文件 = 全部用 peerKey 当名字 */ }
    const memKeys = entry.recentPeers instanceof Map ? [...entry.recentPeers.keys()] : []
    const keys = new Set([...Object.keys(store ?? {}), ...memKeys])
    for (const key of keys) {
      const lastAt = Math.max(Number(store?.[key]?.lastAt ?? 0), Number(entry.recentPeers?.get(key) ?? 0)) || null
      const prev = byKey.get(key)
      if (prev && (prev.lastAt ?? 0) >= (lastAt ?? 0)) continue
      byKey.set(key, {
        key,
        name: store?.[key]?.name || (key.startsWith('group:') ? `群 ${key.slice(6)}` : key),
        kind: key.startsWith('group:') ? 'group' : 'private',
        lastAt,
        recentMessage: null,
        _api: entry.api ?? null,
      })
    }
  }
  const peers = [...byKey.values()]
    .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
    .slice(0, PEERS_LIMIT)

  const previewTargets = peers.filter((p) => p.kind === 'private' && p._api).slice(0, PEERS_PREVIEW_COUNT)
  await Promise.all(previewTargets.map(async (p) => {
    try {
      const r = await p._api.call('get_friend_msg_history', { user_id: Number(p.key), count: 1, message_seq: 0 })
      const msgs = r?.messages ?? []
      const m = msgs[msgs.length - 1]
      if (m) {
        const who = m?.sender?.card || m?.sender?.nickname || '对方'
        p.recentMessage = `${who}：${extractPreview(m.message)}`.slice(0, PEERS_PREVIEW_LEN)
      }
    } catch { /* 预览拉不到就空着 */ }
  }))

  return peers.map(({ _api, ...rest }) => rest)
}

// ── qq.json 读写（autoBoot 开关；QQ 连接参数归 qq-setup 管，这里只碰这一个字段）──
async function readQQConfig(file = QQ_CONFIG_FILE) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null }
}
async function writeQQConfig(config, file = QQ_CONFIG_FILE) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(config, null, 2) + '\n')
}

export function startRouteServer({ port = 3939, getQQ, getAllQQ, getStatus, boot: bootOverride, log = () => {} } = {}) {
  const boot = bootOverride ?? createNapCatBoot({ log })
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      if (!isLoopback(req)) return json(res, 403, { ok: false, error: '仅限本机访问' })

      // ── 跨源栅栏：设置页片段由 DSH Web 源（回环）加载后跨源 fetch 本服务器。
      //    Origin 缺失（她的 node fetch / curl）照旧放行；带 Origin 的浏览器请求
      //    只认回环来源（反射 ACAO），外来站点既拿不到响应也过不了预检（fail-closed）。
      const origin = req.headers?.origin ? String(req.headers.origin) : ''
      const originTrusted = !origin || isLoopbackOrigin(origin)
      if (origin && !originTrusted) return json(res, 403, { ok: false, error: '不受信任的来源' })
      if (req.method === 'OPTIONS') {
        if (origin && originTrusted) {
          res.setHeader('access-control-allow-origin', origin)
          res.setHeader('vary', 'origin')
          res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
          res.setHeader('access-control-allow-headers', 'content-type')
          res.setHeader('access-control-max-age', '600')
        }
        res.statusCode = 204
        return res.end()
      }
      if (origin && originTrusted) {
        res.setHeader('access-control-allow-origin', origin)
        res.setHeader('vary', 'origin')
      }

      if (req.method === 'GET' && url.pathname === '/status') {
        return json(res, 200, { ok: true, ...(getStatus?.() ?? {}) })
      }

      if (req.method === 'GET' && url.pathname === '/personas') {
        try {
          return json(res, 200, { ok: true, personas: await listPersonas() })
        } catch (e) {
          return json(res, 200, { ok: false, error: `人设模板读取失败：${e?.message ?? e}`, personas: [] })
        }
      }

      if (req.method === 'GET' && url.pathname === '/outbox/list') {
        return json(res, 200, { ok: true, drafts: await listOutboxDrafts() })
      }

      if (req.method === 'POST' && url.pathname === '/outbox/approve') {
        const body = await readJsonBody(req)
        if (typeof body?.approve !== 'boolean') {
          return json(res, 400, { ok: false, error: '需要 approve 布尔字段（true=放行，false=拒绝）' })
        }
        const result = await approveOutboxDraft({
          file: body?.file,
          approve: body.approve,
          getQQ: () => getQQ(body?.whale),
          log,
        })
        if (result.error) return json(res, 400, { ok: false, error: result.error })
        return json(res, 200, { ok: true, result })
      }

      if (req.method === 'GET' && url.pathname === '/peers') {
        return json(res, 200, { ok: true, peers: await listPeers({ getAllQQ }) })
      }

      if (req.method === 'GET' && url.pathname === '/settings-page') {
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        return res.end(settingsPage())
      }

      if (req.method === 'POST' && url.pathname === '/qq/send') {
        const body = await readJsonBody(req)
        const to = String(body?.to ?? '')
        const text = String(body?.text ?? '').trim()
        if (!to || !text) return json(res, 400, { ok: false, error: '需要 to 与 text 字段' })
        if (text.length > 2000) return json(res, 400, { ok: false, error: 'text 过长（>2000）' })

        const qq = getQQ(body?.whale)
        if (!qq) return json(res, 404, { ok: false, error: '没有已就绪的 QQ 平台（先配置账号并启动）' })

        const lastInboundAt = qq.recentPeers.get(String(to))
        const decision = decideSend({ approvalMode: qq.whale.approvalMode, lastInboundAt })

        const record = { at: new Date().toISOString(), via: 'session-route', to, text, executed: decision.execute, reason: decision.reason }
        await mkdir(OUTBOX_DIR, { recursive: true })
        await writeFile(path.join(OUTBOX_DIR, `qq-${Date.now()}.json`), JSON.stringify(record, null, 2) + '\n')

        if (!decision.execute) {
          log(`QQ 发送被裁决为草稿：${decision.reason}`)
          return json(res, 200, { ok: true, executed: false, draft: true, reason: decision.reason, hint: '草稿已存 outbox，主人可放行' })
        }
        const isGroup = String(to).startsWith('group:')
        const peer = isGroup ? String(to).slice(6) : to
        const r = isGroup ? await qq.api.sendGroup(peer, text) : await qq.api.sendPrivate(peer, text)
        log(`QQ 已发送 → ${to}（messageId=${r?.message_id}）`)
        return json(res, 200, { ok: true, executed: true, messageId: r?.message_id })
      }

      // ── NapCat 控制台：状态 / 启动 / 重启（刷新二维码）/ 二维码 / autoBoot ──
      if (req.method === 'GET' && url.pathname === '/qq/napcat') {
        const config = await readQQConfig()
        const [running, qr] = await Promise.all([boot.isRunning(), Promise.resolve(boot.qrcode())])
        const wsState = (getQQ()?.state?.() ?? {}).receiver ?? null
        return json(res, 200, {
          ok: true,
          installed: running.installed,
          running: running.running,
          wsState, // online = 反向 WS 已连（真·在线）；listening + running = 等待登录
          selfId: config?.selfId ?? null,
          autoBoot: config ? config.autoBoot !== false : false,
          qr: { available: qr.available, mtimeMs: qr.mtimeMs ?? null, ageMs: qr.ageMs ?? null, stale: qr.stale ?? false },
        })
      }

      if (req.method === 'POST' && url.pathname === '/qq/napcat/start') {
        const config = await readQQConfig()
        const r = await boot.start(config?.selfId)
        if (r.error) return json(res, 400, { ok: false, error: r.error })
        return json(res, 200, { ok: true, ...r })
      }

      if (req.method === 'POST' && url.pathname === '/qq/napcat/restart') {
        const config = await readQQConfig()
        const r = await boot.restart(config?.selfId)
        if (r.error) return json(res, 400, { ok: false, error: r.error })
        return json(res, 200, { ok: true, ...r })
      }

      if (req.method === 'GET' && url.pathname === '/qq/qrcode') {
        const qr = boot.qrcode()
        if (!qr.available) return json(res, 404, { ok: false, error: '二维码尚未生成（NapCat 未启动或已直接登录）' })
        const png = await readFile(qr.file)
        res.statusCode = 200
        res.setHeader('content-type', 'image/png')
        res.setHeader('cache-control', 'no-store')
        return res.end(png)
      }

      if (req.method === 'POST' && url.pathname === '/qq/autoboot') {
        const body = await readJsonBody(req)
        if (typeof body?.enabled !== 'boolean') return json(res, 400, { ok: false, error: '需要 enabled 布尔字段' })
        const config = (await readQQConfig()) ?? {}
        if (!config.selfId) return json(res, 400, { ok: false, error: 'qq.json 缺少 selfId（先跑 scripts/qq-setup.mjs）' })
        config.autoBoot = body.enabled
        await writeQQConfig(config)
        log(`NapCat 自动拉起：${body.enabled ? '开' : '关'}`)
        return json(res, 200, { ok: true, enabled: body.enabled })
      }

      json(res, 404, { ok: false, error: `未知路由 ${req.method} ${url.pathname}` })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message ?? e) })
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      log(`行动路由服务器已启动 http://127.0.0.1:${actual}（status | qq/send | personas | outbox | peers | napcat | settings-page）`)
      resolve({
        port: actual,
        stop: () => server.close(),
      })
    })
    server.on('error', (e) => log(`路由服务器错误：${e.message}`))
  })
}
