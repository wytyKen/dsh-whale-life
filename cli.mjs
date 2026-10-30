#!/usr/bin/env node
// 鲸生 CLI：鲸鱼娘的会话（以及主人）用它操作 B站。
// 用法：node cli.mjs bili <login|status|nav|dynamic|video|search|sessions> [参数]
// 凭据约定：data/secrets/bili.json（与 examples 配置一致）；API 状态：data/bili/

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { loadCredentials, createCredentialStore, protectFile } from './src/platforms/bilibili/credentials.js'
import { QrAuth, verifyAccount } from './src/platforms/bilibili/auth.js'
import { createBiliClient } from './src/platforms/bilibili/api.js'
import { createReader } from './src/platforms/bilibili/reader.js'
import { loadQQConfig } from './src/platforms/qq/index.js'
import { createQQApi } from './src/platforms/qq/api.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const CRED_FILE = path.join(ROOT, 'data', 'secrets', 'bili.json')
const STATE_DIR = path.join(ROOT, 'data', 'bili')
const QR_PNG = path.join(ROOT, 'data', 'secrets', 'login-qr.png')

const [platform, command, ...rest] = process.argv.slice(2)

function out(obj) {
  console.log(JSON.stringify(obj, null, 2))
}

function requireCredentials() {
  const credentials = loadCredentials(CRED_FILE)
  if (!credentials) {
    out({ ok: false, error: `尚未登录 B站。先执行：node cli.mjs bili login`, credentialsFile: CRED_FILE })
    process.exit(2)
  }
  return credentials
}

function makeReader() {
  const credentials = requireCredentials()
  const client = createBiliClient({ stateDir: STATE_DIR })
  return { reader: createReader({ client, credentials }), client }
}

async function biliLogin() {
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
  const store = createCredentialStore({ file: CRED_FILE, verify: verifyAccount })
  const qr = new QrAuth({
    save: store.save,
    onRender: async (url) => {
      // 终端 ASCII 码 + PNG 文件双输出
      const ascii = await import('qrcode').then((m) => m.default.toString(url, { type: 'terminal', small: true }))
      fs.mkdirSync(path.dirname(QR_PNG), { recursive: true })
      await import('qrcode').then((m) => m.default.toFile(QR_PNG, url, { width: 300, margin: 2 }))
      console.log(ascii)
      console.log(`二维码已存为 ${QR_PNG}（3 分钟内有效）`)
      console.log('请用手机 B站 App 扫码并确认登录……')
      return ascii
    },
  })
  const session = await qr.start()
  console.log(`[登录会话 ${session.id}] 等待扫码……`)
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000))
    const state = await qr.poll(session.id)
    if (state.status === 'waiting') { process.stdout.write('.'); continue }
    if (state.status === 'scanned') { console.log('\n已扫码，请在手机上确认登录……'); continue }
    if (state.status === 'success') {
      console.log(`\n✓ 登录成功：${state.account.name}（mid=${state.account.mid}）`)
      console.log(`✓ 凭据已加密保存：${CRED_FILE}`)
      out({ ok: true, account: state.account })
      return
    }
    out({ ok: false, status: state.status, error: state.error ?? '二维码过期，请重新执行 login' })
    process.exit(1)
  }
}

async function biliStatus() {
  const client = createBiliClient({ stateDir: STATE_DIR })
  const credentials = loadCredentials(CRED_FILE)
  const state = client.state()
  if (!credentials) return out({ ok: false, logged: false, api: state, hint: '执行 node cli.mjs bili login' })
  const reader = createReader({ client, credentials })
  const nav = await reader.nav()
  out({
    ok: nav.code === 0,
    logged: nav.data?.isLogin === true,
    account: nav.data?.isLogin ? { mid: nav.data.mid, name: nav.data.uname } : null,
    wbiKey: nav.data?.wbi_img ? 'available' : 'missing',
    api: state,
  })
}

async function main() {
  if (platform === 'qq') return await qqMain()
  if (platform !== 'bili') {
    out({ ok: false, error: '用法：node cli.mjs bili <login|status|nav|dynamic|video|search|sessions>  |  qq <status|self|friends|send> [参数]' })
    process.exit(1)
  }
  try {
    switch (command) {
      case 'login': return await biliLogin()
      case 'status': return await biliStatus()
      case 'nav': {
        const { reader } = makeReader()
        const nav = await reader.nav()
        return out({ ok: nav.code === 0, account: nav.data?.isLogin ? { mid: nav.data.mid, name: nav.data.uname } : null })
      }
      case 'dynamic': {
        const { reader } = makeReader()
        const hostMid = process.argv.includes('--mid') ? process.argv[process.argv.indexOf('--mid') + 1] : undefined
        const feed = await reader.dynamics({ hostMid })
        const items = (feed.data?.items ?? []).slice(0, 10).map((it) => ({
          type: it.type ?? null,
          text: (it.modules?.module_content?.desc?.text ?? '').slice(0, 80) || null,
          author: it.modules?.module_author?.name ?? null,
        }))
        return out({ ok: feed.code === 0, count: items.length, items })
      }
      case 'video': {
        const { reader } = makeReader()
        if (!rest[0]) throw new Error('用法：video <BV号>')
        const v = await reader.video(rest[0])
        const d = v.data
        return out({
          ok: v.code === 0,
          video: d ? { bvid: d.bvid, title: d.title, owner: d.owner?.name, stat: d.stat, cid: d.cid } : null,
        })
      }
      case 'search': {
        const { reader } = makeReader()
        if (!rest[0]) throw new Error('用法：search <关键词>')
        const s = await reader.search(rest.join(' '))
        const results = (s.data?.result ?? []).slice(0, 10).map((r) => ({
          title: String(r.title ?? '').replace(/<[^>]+>/g, ''), author: r.author, play: r.play,
        }))
        return out({ ok: s.code === 0, count: results.length, results })
      }
      case 'sessions': {
        const { reader } = makeReader()
        const s = await reader.sessions()
        return out({ ok: s.code === 0, unread: s.data?.unread_unfollow + s.data?.unread_follow ?? null })
      }
      default:
        out({ ok: false, error: `未知命令：${command}` })
        process.exit(1)
    }
  } catch (e) {
    out({ ok: false, error: e.message })
    process.exit(1)
  }
}

async function qqMain() {
  const config = await loadQQConfig()
  if (!config) {
    out({
      ok: false,
      error: `缺少连接配置 ${path.join(ROOT, 'data', 'secrets', 'qq.json')}`,
      hint: '写入 { "httpBase": "http://127.0.0.1:3000", "wsPort": 3001, "accessToken": "<token>", "selfId": <QQ号> }，并在 NapCat 配好 HTTP 服务端与反向 WS（详见 docs/platforms/qq-technical-proposal.md）',
    })
    process.exit(2)
  }
  const api = createQQApi({ config })
  const args = process.argv.slice(process.argv.indexOf('qq') + 1)
  const cmd = args[0]
  if (cmd === 'status' || cmd === 'self') {
    try {
      const info = await api.getLoginInfo()
      return out({ ok: true, account: info, httpBase: config.httpBase })
    } catch (e) {
      return out({ ok: false, error: e.message, hint: '确认 NapCat 已运行且 HTTP 服务端已配置' })
    }
  }
  if (cmd === 'friends') {
    const list = await api.getFriendList()
    return out({ ok: true, count: list?.length, friends: (list ?? []).slice(0, 20).map((f) => ({ qq: f.user_id, name: f.nickname, remark: f.remark })) })
  }
  if (cmd === 'send') {
    const toIdx = args.indexOf('--to')
    const yesIdx = args.indexOf('--yes')
    const target = toIdx >= 0 ? args[toIdx + 1] : null
    const text = args.slice(toIdx >= 0 ? toIdx + 2 : 1).filter((a) => a !== '--yes' && a !== target).join(' ')
    if (!target || !text) throw new Error('用法：qq send --to <QQ号|group:群号> <内容> [--yes]')
    const isGroup = String(target).startsWith('group:')
    const peer = isGroup ? String(target).slice(6) : target
    // 审计留痕：无论发不发都先落 outbox
    const outboxDir = path.join(ROOT, 'data', 'outbox')
    fs.mkdirSync(outboxDir, { recursive: true })
    const record = { at: new Date().toISOString(), via: 'cli', to: target, text, executed: yesIdx >= 0 }
    fs.writeFileSync(path.join(outboxDir, `qq-${Date.now()}.json`), JSON.stringify(record, null, 2) + '\n')
    if (yesIdx < 0) {
      return out({ ok: false, executed: false, draft: record, hint: '这是 dry-run 草稿（已存 outbox）。确认无误后加 --yes 真正发送。' })
    }
    const r = isGroup ? await api.sendGroup(peer, text) : await api.sendPrivate(peer, text)
    return out({ ok: true, messageId: r?.message_id, record })
  }
  out({ ok: false, error: `未知命令：${cmd}（status | self | friends | send）` })
  process.exit(1)
}

await main()
