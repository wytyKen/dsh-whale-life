import { loadConfig } from './src/config/schema.js'
import { resolvePersona } from './src/config/persona.js'
import { ensureWhaleDirs, vitalsLine } from './src/whale/instance.js'

export const name = 'dsh-whale-life'

export function apply(ctx, config = {}) {
  const log = (...args) => console.log('[whale-life]', ...args)
  const result = loadConfig(config)

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
    for (const whale of result.whales) {
      const persona = await resolvePersona(whale.persona)
      if (!persona.ok) {
        log(`✗ #${whale.id} 人设解析失败：${persona.error}`)
        continue
      }
      await ensureWhaleDirs(whale.id)
      log(vitalsLine(whale, persona.value))
    }
  })

  ctx.on('dispose', () => log('DSH 关闭，鲸生沉睡。'))
}
