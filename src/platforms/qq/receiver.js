// 反向 WebSocket 接收端：NapCat 主动连进来（其自带重连），我们只管收。
// 改编自 dsh-whale-notify（MIT © Lenai）的 startQQReceiver：
//   · accessToken 校验 Authorization: Bearer
//   · 90s 无数据帧的看门狗（防半开连接）
//   · X-Self-ID 头作为 selfId 兜底
// 追加：onState 联动风控状态机、端口 0 支持随机分配（测试用）。

import { createRequire } from 'node:module'
import { normalizeOneBotMessage } from './onebot.js'

const require = createRequire(import.meta.url)

export function startQQReceiver({ config, onMessage, onState, log = () => {}, WebSocketServer } = {}) {
  let WSS = WebSocketServer
  if (WSS === undefined) {
    try {
      WSS = require('ws').WebSocketServer
    } catch (error) {
      log(`缺少可选依赖 ws（${error instanceof Error ? error.message : String(error)}）—— QQ 接收端未启动；请在 profile 里安装 ws。`)
      onState?.('failed', '缺少 ws 依赖')
      return { stop: () => {}, port: null }
    }
  }

  const port = Number(config?.wsPort ?? 3001)
  const host = config?.wsHost === '0.0.0.0' ? '0.0.0.0' : (config?.wsHost || '127.0.0.1')

  const wss = new WSS({
    port, host,
    verifyClient: config?.accessToken
      ? (info, done) => {
          const header = String(info.req?.headers?.authorization ?? '')
          const token = header.replace(/^Bearer\s+/i, '')
          if (token === '' || token === String(config.accessToken)) return done(true)
          log('拒绝了凭证不匹配的反向 WS 连接')
          return done(false, 401, 'unauthorized')
        }
      : undefined,
  })

  wss.on('error', (error) => {
    log(`QQ 接收端启动失败（ws://${host}:${port}）：${error instanceof Error ? error.message : String(error)}`)
    onState?.('failed', String(error))
  })

  wss.on('listening', () => {
    const actual = wss.address()?.port ?? port
    log(`QQ OneBot 接收端已启动 ws://${host}:${actual}（在 NapCat 里把它配成反向 WS 地址）`)
    onState?.('listening', { host, port: actual })
  })

  wss.on('connection', (socket, request) => {
    log('NapCat 已连接')
    onState?.('online')
    const selfId = request?.headers?.['x-self-id'] ?? config?.selfId
    let lastFrame = Date.now()
    const watchdog = setInterval(() => {
      if (Date.now() - lastFrame > 90_000) {
        log('NapCat 连接超时（90s 无数据），主动断开')
        onState?.('degraded', '90s 无数据帧')
        try { socket.terminate() } catch { /* ignore */ }
      }
    }, 30_000)
    watchdog.unref?.()

    socket.on('close', () => { clearInterval(watchdog); onState?.('offline', '连接关闭') })
    socket.on('error', () => clearInterval(watchdog))

    socket.on('message', (raw) => {
      lastFrame = Date.now()
      let payload
      try { payload = JSON.parse(raw.toString()) } catch { return }
      const message = normalizeOneBotMessage(payload, selfId)
      if (message) onMessage(message)
    })
  })

  return {
    stop() {
      try { wss.close() } catch { /* ignore */ }
    },
    get port() { return wss.address()?.port ?? null },
  }
}
