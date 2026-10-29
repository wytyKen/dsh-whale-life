export const name = 'dsh-whale-life'

export function apply(ctx) {
  const log = (...args) => console.log('[whale-life]', ...args)

  ctx.on('ready', () => {
    log('鲸生 v0.0.1 已加载——她还在沉睡，等待第一份配置。')
  })

  ctx.on('dispose', () => {
    log('DSH 关闭，鲸生沉睡。')
  })
}
