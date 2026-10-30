import path from 'node:path'
import { mkdir, appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './src/config/schema.js'
import { resolvePersona } from './src/config/persona.js'
import { ensureWhaleDirs, vitalsLine } from './src/whale/instance.js'
import { createTicker } from './src/rhythm/ticker.js'
import { shouldFire } from './src/rhythm/cron.js'
import { recallContext, appendDiary } from './src/memory/store.js'
import { createSessionBridge } from './src/whale/session.js'
import { personaBlock, wakePrompt } from './src/whale/wake.js'
import { createApprover, modeFromConfig } from './src/behavior/approver.js'
import { startRouteServer } from './src/behavior/routes.js'
import { registerQQ } from './src/platforms/qq/index.js'

export const name = 'dsh-whale-life'
// cordis 4.x：访问服务必须在此声明（注入即必需依赖）。
// sessionController：唤醒她的会话（Web 组合挂载）。
// 行动路由已改为插件自有的独立 HTTP 服务器（127.0.0.1:3939），不再依赖 webServer。
export const inject = ['sessionController']

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const LOG_FILE = path.join(PLUGIN_ROOT, 'data', 'whale-life.log')

// 依配置生成她「能做什么」的能力清单（写给她的唤醒提示词）
function capabilitiesFor(whale, webPort) {
  const caps = []
  const has = (platform) => whale.accounts.some((a) => a.platform === platform)
  if (has('bilibili')) {
    caps.push(
      `B站（只读）：在你的终端执行 node "${path.join(PLUGIN_ROOT, 'cli.mjs')}" bili status / dynamic / video <BV号> / search <关键词>`,
      `B站登录由主人完成：node "${path.join(PLUGIN_ROOT, 'cli.mjs')}" bili login（扫码，凭据存本地）`,
    )
  }
  if (has('qq') && webPort) {
    caps.push(
      `QQ（被动收听 + 自主回复）：收到私聊或被 @ 时你会被唤醒。回复不需要开终端——用你的 fetch/网页工具 POST http://127.0.0.1:${webPort}/qq/send ，JSON body {"to":"<对方QQ号或group:群号>","text":"<回复内容>"}。审批与频率限制由插件强制：semi 档下你只能回话（对方 30 分钟内来过才能发），不能主动搭讪。`,
    )
  }
  return caps
}

export function apply(ctx, config = {}) {
  // 双通道日志：stdout 可能被宿主应用吞掉，文件日志保证「可观察」
  mkdir(path.dirname(LOG_FILE), { recursive: true }).catch(() => {})
  const log = (...args) => {
    console.log('[whale-life]', ...args)
    appendFile(LOG_FILE, `[${new Date().toISOString()}] ${args.join(' ')}\n`).catch(() => {})
  }
  log(`apply() 已调用（插件模块加载成功）`)
  const result = loadConfig(config)
  let ticker = null
  const qqReceivers = []
  const qqRegistry = new Map() // whaleId → { whale, api, recentPeers }
  let stopRoutes = null
  let routePort = null

  // cordis 4.x 没有 'ready' 事件：启动逻辑在 apply 内直接跑，清理走 ctx.effect
  const bootstrap = async () => {
    if (!result.ok) {
      log('✗ 配置校验失败，她无法醒来：')
      for (const err of result.errors) log('  -', err)
      return
    }
    if (result.whales.length === 0) {
      log('鲸生已加载——尚未配置任何鲸鱼，她还在沉睡。（配置见 docs/configuration.md）')
      return
    }

    // 注入已声明，apply 时服务必然可用
    const controller = ctx.sessionController

    const whales = []
    for (const whale of result.whales) {
      const persona = await resolvePersona(whale.persona)
      if (!persona.ok) {
        log(`✗ #${whale.id} 人设解析失败：${persona.error}`)
        continue
      }
      const home = await ensureWhaleDirs(whale.id, PLUGIN_ROOT)
      whales.push({
        whale,
        persona: persona.value,
        home,
        fired: new Set(),
        approver: createApprover({ mode: modeFromConfig(whale.approvalMode) }),
        bridge: createSessionBridge({
          controller,
          whaleHome: home,
          cwd: home,
          personaBlock: () => personaBlock(persona.value, whale),
          model: whale.runtime.model ?? 'deepseek-flash',
          log,
        }),
      })
      log(vitalsLine(whale, persona.value))
      // QQ 平台：装配接收端（NapCat 反向 WS）→ 被动唤醒
      if (whale.accounts.some((a) => a.platform === 'qq')) {
        const last = whales[whales.length - 1]
        const recentPeers = new Map() // peerKey → 最近来信时间（semi 档回话窗口判定用）
        const qq = await registerQQ({ whale, bridge: last.bridge, recentPeers, webPort: () => routePort, log })
        if (qq) {
          last.qq = qq
          qqReceivers.push(qq)
          qqRegistry.set(whale.id, { whale, api: qq.api, recentPeers })
        }
      }
    }

    // 行动路由：插件自有的独立 HTTP 服务器（审批/节流/留痕在插件进程内强制）
    const routes = await startRouteServer({
      port: Number(config.routePort ?? 3939),
      getQQ: (whaleId) => (whaleId ? qqRegistry.get(whaleId) : [...qqRegistry.values()][0] ?? null),
      getStatus: () => ({
        whales: whales.map((w) => ({
          id: w.whale.id,
          persona: w.persona.name,
          approvalMode: w.whale.approvalMode,
          qq: w.qq ? w.qq.state() : null,
        })),
      }),
      log,
    })
    stopRoutes = routes.stop
    routePort = routes.port
    if (!controller) {
      log('⚠ sessionController 缺失：心跳照常，但无法唤醒会话')
    }

    ticker = createTicker({
      log,
      onTick: async () => {
        for (const w of whales) {
          for (const entry of w.whale.rhythm.cron) {
            const { fire, key } = shouldFire(
              { expr: entry.expr, timezone: w.whale.rhythm.timezone },
              w.fired,
            )
            if (!fire) continue
            w.fired.add(key)
            if (w.fired.size > 10_000) w.fired.clear()
            if (!controller) continue
            try {
              const memory = await recallContext(w.home)
              await w.bridge.wake(wakePrompt({
                persona: w.persona, whale: w.whale, action: entry.action, memory,
                capabilities: capabilitiesFor(w.whale, routePort),
              }))
              await appendDiary(w.home, {
                text: `醒来执行：${entry.action}`,
                timezone: w.whale.rhythm.timezone,
              })
              log(`「${w.persona.name}」醒来：${entry.action}`)
            } catch (e) {
              w.fired.delete(key)
              const detail = [e?.details?.reason ?? e?.data?.reason, e?.code, e?.cause?.message]
                .filter(Boolean).join(' | ')
              log(`唤醒失败（下一轮重试）：${e.message}${detail ? ' ← ' + detail : ''}`)
            }
          }
        }
      },
    })
    ticker.start()
  }

  bootstrap().catch((e) => log(`启动失败：${e.message}`))

  ctx.effect(() => () => {
    stopRoutes?.()
    for (const qq of qqReceivers) qq.stop()
    ticker?.stop()
    log('DSH 关闭，鲸生沉睡。')
  })
}
