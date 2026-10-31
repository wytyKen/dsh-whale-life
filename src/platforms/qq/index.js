// QQ 平台注册入口：装配会话管理器 + 回复捕获器 + 接收端。
// 连接配置 data/secrets/qq.json：
//   { "httpBase": "http://127.0.0.1:3000", "wsPort": 3001, "accessToken": "...", "selfId": 123456 }
// NapCat 侧需配：HTTP 服务端（3000）+ 反向 WS 客户端（ws://127.0.0.1:3001，同一 token）。

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createQQApi } from './api.js'
import { startQQReceiver } from './receiver.js'
import { createQQSession } from './session.js'
import { createConversationManager } from './conversation.js'
import { createResponder } from './responder.js'
import { createPeerStore } from './catchup.js'
import { createNapCatBoot } from './boot.js'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const QQ_CONFIG_FILE = path.join(PLUGIN_ROOT, 'data', 'secrets', 'qq.json')

export async function loadQQConfig(file = QQ_CONFIG_FILE) {
  try {
    const config = JSON.parse(await readFile(file, 'utf8'))
    if (!config || typeof config !== 'object') return null
    return config
  } catch {
    return null
  }
}

/**
 * 为一只配置了 qq 平台的鲸鱼装配 QQ 能力。
 * @returns {{ stop(): void, api, selfId, peersFile, conversationManager, state(): object } | null}
 */
export async function registerQQ({ whale, home, controller, workspaceId, persona, recentPeers, log = () => {}, config: override } = {}) {
  const config = override ?? await loadQQConfig()
  if (!config) {
    log(`⚠ #${whale.id} 配置了 QQ，但缺少连接文件 ${QQ_CONFIG_FILE} —— QQ 未接入`)
    return null
  }

  const api = createQQApi({ config })

  // autoBoot（默认开）：DSH 启动即拉起 NapCat——登录态有效时全自动连上，
  // 失效则等扫码（设置页「QQ 接入」卡片会内嵌显示二维码）。
  if (config.autoBoot !== false) {
    const boot = createNapCatBoot({ log })
    boot.isRunning().then((info) => {
      if (info.installed && !info.running) {
        log('autoBoot：NapCat 未在运行，自动拉起（快速登录）…')
        return boot.start(config.selfId)
      }
      return null
    }).catch(() => {})
  }

  // home 已是 data/<whaleId>，不要再拼 whale.id（避免 data/<id>/<id>/ 翻倍）
  const peerStore = createPeerStore(path.join(home, 'qq-peers.json'))

  const conversationManager = createConversationManager({
    controller,
    whaleHome: home,
    workspaceId,
    persona,
    whale,
    log,
  })

  const responder = createResponder({
    api,
    conversationManager,
    log,
  })

  const session = createQQSession({
    whale,
    api,
    selfId: config.selfId,
    conversationManager,
    responder,
    recentPeers,
    mfaceLibrary: conversationManager.mfaceLibrary,
    peerStore,
    log,
  })

  let lastState = 'init'
  let lastWhy = null
  const receiver = startQQReceiver({
    config,
    onMessage: (m) => { session.handle(m).catch((e) => log(`QQ 消息处理失败：${e.message}`)) },
    onState: (state, why) => { lastState = state; lastWhy = why ?? null },
    log,
  })

  return {
    api,
    selfId: config.selfId ?? null,
    conversationManager,
    peersFile: path.join(home, 'qq-peers.json'),
    stop: () => receiver.stop(),
    state: () => ({ receiver: lastState, why: lastWhy, port: receiver.port }),
  }
}
