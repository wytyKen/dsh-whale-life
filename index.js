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
import { registerSettingsSection } from './src/behavior/settings-section.js'
import { registerQQ } from './src/platforms/qq/index.js'
import { runCatchUp } from './src/platforms/qq/catchup.js'
import { actionCatalogPrompt, parseActionBlock, createActionExecutor } from './src/behavior/actions.js'
import { getProjcacheStats, waitTurnComplete } from './src/whale/projcache.js'

export const name = 'dsh-whale-life'
// cordis 4.x：访问服务必须在此声明（注入即必需依赖）。
// sessionController：唤醒她的会话（Web 组合挂载）。
// 行动路由已改为插件自有的独立 HTTP 服务器（127.0.0.1:3939），不再依赖 webServer。
export const inject = ['sessionController', 'workspaceRegistry']

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
    // 主动行动（发空间动态等）：她在唤醒回复的末尾写 ```action 块，插件解析→审批→执行
    caps.push(actionCatalogPrompt())
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
  let stopSettings = null
  let routePort = null
  const pendingCatchups = []

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
      // 工作区挂载：让她的会话在 DSH 界面归入以其家目录命名的工作区（而非「未分组」）
      let workspaceId
      try {
        const registry = ctx.workspaceRegistry
        if (registry) {
          // registry.create 直接收路径字符串（Remote 层才收 {path} 包装）
          const ws = await registry.create(home)
          workspaceId = ws?.id ?? ws?.workspaceId ?? null
          log(`工作区就绪：${ws?.title ?? home}${workspaceId ? '（新会话将归入）' : '（id 缺失，回退目录模式）'}`)
        }
      } catch (e) {
        log(`工作区挂载失败（回退目录模式）：${e.message}`)
      }
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
          ...(workspaceId ? { workspaceId } : {}),
          personaBlock: () => personaBlock(persona.value, whale),
          model: whale.runtime.model ?? 'deepseek-flash',
          log,
        }),
      })
      log(vitalsLine(whale, persona.value))
      // QQ 平台：装配会话管理器 + 回复捕获器 + 接收端（NapCat 反向 WS）
      if (whale.accounts.some((a) => a.platform === 'qq')) {
        const last = whales[whales.length - 1]
        const recentPeers = new Map()
        const qq = await registerQQ({
          whale, home, controller, workspaceId,
          persona: persona.value, recentPeers, log,
        })
        if (qq) {
          last.qq = qq
          qqReceivers.push(qq)
          qqRegistry.set(whale.id, { whale, api: qq.api, selfId: qq.selfId, state: qq.state, recentPeers, peersFile: qq.peersFile })
        }
      }
    }

    // 行动路由：插件自有的独立 HTTP 服务器（审批/节流/留痕在插件进程内强制）
    const getQQByWhale = (whaleId) => (whaleId ? qqRegistry.get(whaleId) : [...qqRegistry.values()][0] ?? null)
    const routes = await startRouteServer({
      port: Number(config.routePort ?? 3939),
      getQQ: getQQByWhale,
      // 会话列表用：枚举全部已就绪的 QQ 平台（/peers）
      getAllQQ: () => [...qqRegistry.values()],
      getStatus: () => ({
        whales: whales.map((w) => ({
          id: w.whale.id,
          persona: w.persona.name,
          approvalMode: w.whale.approvalMode,
          qq: w.qq ? w.qq.state() : null,
        })),
        // 心跳：ticker 在路由启动之后才创建，闭包在请求时读取即得最新状态
        ticker: { running: ticker?.running ?? false },
      }),
      log,
    })
    stopRoutes = routes.stop
    routePort = routes.port

    // 行动执行器：她的 ```action 意图 → 审批 → NapCat 执行（发动态等），留痕 outbox
    const actionExecutor = createActionExecutor({ getQQ: getQQByWhale, log })

    // 唤醒回复落地：等她写完 → 独白进日记 → 行动块解析执行
    async function watchWakeReply(w, baselineTurns) {
      const sessionId = w.bridge.sessionId
      if (!sessionId) return
      const reply = await waitTurnComplete(sessionId, baselineTurns, { timeoutMs: 180_000 })
      if (reply == null) {
        log(`「${w.persona.name}」的唤醒回复未捕获（超时或空）——行动跳过`)
        return
      }
      const actions = parseActionBlock(reply)
      const monologue = reply.replace(/```action[\s\S]*?```/g, '').trim()
      if (monologue) {
        await appendDiary(w.home, {
          text: `醒来独白：${monologue.slice(0, 400)}`,
          timezone: w.whale.rhythm.timezone,
        })
      }
      for (const action of actions) {
        const r = await actionExecutor.execute(w.whale.id, action)
        log(`行动 ${action.op} → ${r.status}${r.status === 'error' ? `（${r.detail}）` : ''}`)
        await appendDiary(w.home, {
          text: `行动 ${action.op}：${r.status === 'executed' ? '已执行' : r.status === 'drafted' ? '草稿待放行' : `失败（${String(r.detail).slice(0, 120)}）`}`,
          timezone: w.whale.rhythm.timezone,
        })
      }
    }

    // 设置页「鲸生」区块：DSH Web 的 webServer 就绪后挂 HTML 片段。
    // 用运行时注入（ctx.inject）：服务出现时回调执行，缺席时静默跳过——
    // 增强入口永不拖垮核心（QQ/路由/心跳）✓；独立页面 http://127.0.0.1:3939/settings-page 恒可用。
    try {
      const fiber = ctx.inject?.(['webServer'], (wsCtx) => {
        stopSettings = registerSettingsSection({ ctx: wsCtx, port: routePort, log })
      })
      if (!fiber) stopSettings = registerSettingsSection({ ctx, port: routePort, log }) // 旧版 cordis 兜底
    } catch (e) {
      log(`设置页区块注入失败（独立页面仍可用）：${e.message}`)
    }

    // 离线补收：路由就绪后，把睡着期间错过的私聊补给她
    for (const cu of pendingCatchups) {
      try {
        const woken = await runCatchUp({ ...cu, routePort, log })
        if (woken) log(`离线补收完成：唤醒 ${woken} 个会话补看错过的消息`)
      } catch (e) {
        log(`离线补收失败（不影响其他功能）：${e.message}`)
      }
    }
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
              // baseline 先取：wake 投递后新回复 = turns 超过它（行动解析靠这个等回复完成）
              const baselineStats = w.bridge.sessionId ? await getProjcacheStats(w.bridge.sessionId) : null
              const baselineTurns = baselineStats?.stats?.turns ?? 0
              await w.bridge.wake(wakePrompt({
                persona: w.persona, whale: w.whale, action: entry.action, memory,
                capabilities: capabilitiesFor(w.whale, routePort),
              }))
              await appendDiary(w.home, {
                text: `醒来执行：${entry.action}`,
                timezone: w.whale.rhythm.timezone,
              })
              log(`「${w.persona.name}」醒来：${entry.action}`)
              // 她的回复完成后：解析 ```action 行动块 → 审批/执行；她的独白进日记（不阻塞 ticker）
              watchWakeReply(w, baselineTurns).catch((e) => log(`行动处理失败（不影响作息）：${e.message}`))
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
    stopSettings?.()
    stopRoutes?.()
    for (const qq of qqReceivers) qq.stop()
    ticker?.stop()
    log('DSH 关闭，鲸生沉睡。')
  })
}
