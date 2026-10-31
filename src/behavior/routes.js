// 插件专属行动路由服务器：独立 HTTP 服务（默认 127.0.0.1:3939），
// 不经过 DSH webServer 的信任门。审批档与 outbox 留痕全部在本模块（插件进程内）强制执行。
//
// 路由：
//   GET  /status         她的生命体征与内置对话状态
//   GET  /personas       人设模板清单（设置页下拉用）
//   GET  /outbox/list    待审草稿清单
//   POST /outbox/approve { file, approve }  拒绝（留痕）/放行（需执行通道）
//   GET  /settings-page  独立管理面板（完整 HTML，同源 fetch 上述 API）

import http from 'node:http'
import path from 'node:path'
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { listPersonas } from '../config/persona.js'
import { settingsPage } from './settings-section.js'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTBOX_DIR = path.join(PLUGIN_ROOT, 'data', 'outbox')
const OUTBOX_LIST_LIMIT = 50 // 待审清单最多返回 50 条

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

function isLoopbackOrigin(origin) {
  try {
    const { hostname } = new URL(origin)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
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
          op: rec.op ?? null,
          text: rec.text ?? '',
          reason: rec.reason ?? '',
        })
      }
    } catch { /* 单个坏文件跳过，不拖垮整个清单 */ }
  }
  return drafts.reverse()
}

// ── Outbox：主人裁决。拒绝 = 标记 rejected 留痕（她会从否决记录里学到「这种不要」）。
//            放行 = 标记放行（真正对外发送需要执行通道——平台回归时接上）。
//            返回 { error } 表示业务失败（不抛异常），草稿原样保留。
async function approveOutboxDraft({ file, approve, log }) {
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

  if (approve === false) {
    const next = { ...record, rejected: true, rejectedAt: new Date().toISOString(), rejectedBy: 'owner' }
    await writeFile(full, JSON.stringify(next, null, 2) + '\n')
    log(`草稿 ${file} 已被主人拒绝（留痕）`)
    return { action: 'rejected', file }
  }

  // 放行：当前无对外执行通道——标记 approved 留痕，待平台回归后真发
  const next = {
    ...record,
    approved: true, approvedAt: new Date().toISOString(), approvedBy: 'owner',
    executed: false, note: '已放行（暂无对外执行通道，平台回归后补发或手动处理）',
  }
  await writeFile(full, JSON.stringify(next, null, 2) + '\n')
  log(`草稿 ${file} 已放行（当前无执行通道，留痕待发）`)
  return { action: 'approved', file, executed: false }
}

export function startRouteServer({ port = 3939, getStatus, log = () => {} } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      if (!isLoopback(req)) return json(res, 403, { ok: false, error: '仅限本机访问' })

      // ── 跨源栅栏：设置页片段由 DSH Web 源（回环）加载后跨源 fetch 本服务器。
      //    Origin 缺失（node fetch / curl）照旧放行；带 Origin 的浏览器请求
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
        const result = await approveOutboxDraft({ file: body?.file, approve: body.approve, log })
        if (result.error) return json(res, 400, { ok: false, error: result.error })
        return json(res, 200, { ok: true, result })
      }

      if (req.method === 'GET' && url.pathname === '/settings-page') {
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        return res.end(settingsPage())
      }

      json(res, 404, { ok: false, error: `未知路由 ${req.method} ${url.pathname}` })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message ?? e) })
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      log(`行动路由服务器已启动 http://127.0.0.1:${actual}（status | personas | outbox | settings-page）`)
      resolve({
        port: actual,
        stop: () => server.close(),
      })
    })
    server.on('error', (e) => log(`路由服务器错误：${e.message}`))
  })
}
