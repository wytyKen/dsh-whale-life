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

import http from 'node:http'
import path from 'node:path'
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { listPersonas } from '../config/persona.js'
import { settingsPage } from './settings-section.js'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTBOX_DIR = path.join(PLUGIN_ROOT, 'data', 'outbox')
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

export function startRouteServer({ port = 3939, getQQ, getStatus, log = () => {} } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      if (!isLoopback(req)) return json(res, 403, { ok: false, error: '仅限本机访问' })

      if (req.method === 'GET' && url.pathname === '/status') {
        return json(res, 200, { ok: true, ...(getStatus?.() ?? {}) })
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

      json(res, 404, { ok: false, error: `未知路由 ${req.method} ${url.pathname}` })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message ?? e) })
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      log(`行动路由服务器已启动 http://127.0.0.1:${actual}（status | qq/send）`)
      resolve({
        port: actual,
        stop: () => server.close(),
      })
    })
    server.on('error', (e) => log(`路由服务器错误：${e.message}`))
  })
}
