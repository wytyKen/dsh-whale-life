// 五字段 Vixie cron 匹配器（minute hour day-of-month month day-of-week）。
// 语义对齐 dsh-schedule 文档：任一日字段为星号时两者都需匹配，都不是星号时匹配任一即可。
// 时区通过 Intl 取墙钟，无第三方依赖。

const FIELD_RANGES = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // weekday（0 和 7 都是周日，规范化为 0）
]

export class CronError extends Error {}

function parseField(field, index) {
  const [min, max] = FIELD_RANGES[index]
  const values = new Set()
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+-\d+|\d+)(?:\/(\d+))?$/)
    if (!m) throw new CronError(`cron 字段非法：'${field}'（不支持 '${part}'）`)
    const step = m[2] ? Number(m[2]) : 1
    if (step < 1) throw new CronError(`cron 步长必须 ≥1：'${field}'`)
    let from, to
    if (m[1] === '*') { from = min; to = max }
    else if (m[1].includes('-')) {
      ;[from, to] = m[1].split('-').map(Number)
      if (from > to) throw new CronError(`cron 范围反了：'${field}'`)
    } else { from = to = Number(m[1]) }
    for (let v = from; v <= to; v += step) {
      if (v < min || v > max) throw new CronError(`cron 值越界：'${field}'`)
      values.add(index === 4 && v === 7 ? 0 : v)
    }
  }
  return values
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new CronError('cron 表达式必须是字符串')
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new CronError(`cron 必须是五字段：'${expr}'`)
  const sets = fields.map((f, i) => parseField(f, i))
  return {
    minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4],
    domIsStar: fields[2] === '*', dowIsStar: fields[4] === '*',
  }
}

// 用 Intl 取某时区的墙钟分量（周几按 ISO 转 cron 惯例：周日=0）
export function wallClockIn(tz, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  })
  const parts = {}
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday]
  return {
    minute: Number(parts.minute), hour: Number(parts.hour) % 24,
    day: Number(parts.day), month: Number(parts.month), dow,
    key: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
  }
}

export function matchesWallClock(cron, wc) {
  if (!cron.minute.has(wc.minute) || !cron.hour.has(wc.hour) || !cron.month.has(wc.month)) return false
  const domOk = cron.dom.has(wc.day)
  const dowOk = cron.dow.has(wc.dow)
  if (cron.domIsStar || cron.dowIsStar) return domOk && dowOk
  return domOk || dowOk
}

// 调度判定：表达式命中当前分钟，且该分钟尚未触发过（分钟级去重，跨时区安全）
export function shouldFire(entry, fired, now = new Date()) {
  const cron = parseCron(entry.expr)
  const wc = wallClockIn(entry.timezone ?? 'Asia/Shanghai', now)
  if (!matchesWallClock(cron, wc)) return { fire: false }
  if (fired.has(wc.key)) return { fire: false }
  return { fire: true, key: wc.key }
}
