import path from 'node:path'
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
// 不声明 inject：cordis 4.x 声明即必需，裸 profile（无 Web 组合）会永远 pending。
// sessionController（DSH Desktop / dsh web 提供）改为每次心跳时惰性获取，就绪前优雅降级。

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

export function apply(ctx, config = {}) {
  const log = (...args) => console.log('[whale-life]', ...args)
  const result = loadConfig(config)
  let ticker = null

  ctx.on('ready', async () => {
    if (!result.ok) {
      log('✗ 配置校验失败，她无法醒来：')
      for (const err of result.errors) log('  -', err)
      return
    }
    if (result.whales.length === 0) {
      log('鲸生已加载——尚未配置任何鲸鱼，她还在沉睡。（配置见 docs/configuration.md）')
      return
    }

    // 惰性获取：Web 组合可能在插件就绪之后才挂载 sessionController
    const controller = () => ctx.sessionController

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
          controller: { create: (r) => controller().create(r), prompt: (r) => controller().prompt(r) },
          whaleHome: home,
          cwd: home,
          personaBlock: () => personaBlock(persona.value, whale),
          log,
        }),
      })
      log(vitalsLine(whale, persona.value))
    }
    if (!controller()) {
      log('⚠ sessionController 尚未就绪：心跳照常，会话唤醒将在 Web 组合就绪后自动可用')
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
            if (!controller()) continue
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
              log(`唤醒失败（下一轮重试）：${e.message}`)
            }
          }
        }
      },
    })
    ticker.start()
  })

  ctx.on('dispose', () => {
    ticker?.stop()
    log('DSH 关闭，鲸生沉睡。')
  })
}
