// 生物钟心跳：DSH 进程活着，她就有心跳；DSH 关闭，心跳随之停止。
// 参照 dsh-bili-whale 的做法：60 秒 tick + 到点唤醒，不做外部 cron。

export function createTicker({ intervalMs = 60_000, onTick, log = () => {} }) {
  let timer = null
  let ticking = false
  let lastTickAt = 0

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      lastTickAt = Date.now()
      await onTick(lastTickAt)
    } catch (e) {
      log(`tick 失败（下一轮重试）：${e.message}`)
    } finally {
      ticking = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(tick, intervalMs)
      if (timer.unref) timer.unref()
      log(`心跳已启动（每 ${intervalMs / 1000}s）`)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
        log('心跳已停止，她沉睡了。')
      }
    },
    get running() { return timer !== null },
    get lastTickAt() { return lastTickAt },
    // 测试口：手动驱动一次
    async poke() { await tick() },
  }
}
