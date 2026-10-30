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

export const name = 'dsh-whale-life'
// cordis 4.x：访问 ctx.sessionController 必须在此声明（注入即必需依赖）。
// 该服务由 Web 组合（DSH Desktop / dsh web）挂载；无会话服务的裸 profile 中
// 插件保持 pending——没有会话就没有唤醒，语义上正确。
export const inject = ['sessionController']

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const LOG_FILE = path.join(PLUGIN_ROOT, 'data', 'whale-life.log')

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
          log,
        }),
      })
      log(vitalsLine(whale, persona.value))
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
              await w.bridge.wake(wakePrompt({
                persona: w.persona, whale: w.whale, action: entry.action, memory,
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
    ticker?.stop()
    log('DSH 关闭，鲸生沉睡。')
  })
}
