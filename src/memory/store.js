// 最小记忆系统：日记（Markdown 追加）+ 事实库（JSON）。
// "第二天醒来时，她接得上昨天的自己。"

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const todayKey = (tz, date = new Date()) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(date)
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(tmp, data)
    await rename(tmp, file)
  } finally {
    await rm(tmp, { force: true })
  }
}

export function memoryFiles(whaleHome) {
  return {
    diary: path.join(whaleHome, 'memory', 'diary.md'),
    facts: path.join(whaleHome, 'memory', 'facts.json'),
  }
}

// 追加一篇日记（同日按时间顺序追加到当日小节，跨日新建小节）
export async function appendDiary(whaleHome, { text, timezone = 'Asia/Shanghai' }, now = new Date()) {
  const { diary } = memoryFiles(whaleHome)
  let existing = ''
  try { existing = await readFile(diary, 'utf8') } catch {}
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(now)
  const key = `## ${todayKey(timezone, now)}`
  const entry = `- ${time} ${text.trim()}`
  const sections = existing ? existing.split(/(?=^## )/m).filter((s) => s.trim()) : []
  const idx = sections.findIndex((s) => s.startsWith(key))
  if (idx >= 0) sections[idx] = sections[idx].trimEnd() + '\n' + entry
  else sections.push(`${key}\n${entry}`)
  const next = sections.join('\n') + '\n'
  await atomicWrite(diary, next)
  return next
}

// 事实库：她认为值得长期记住的事 { at, kind, text }
export async function recordFact(whaleHome, { kind = 'note', text }, now = new Date()) {
  const { facts } = memoryFiles(whaleHome)
  const list = await readJson(facts, [])
  const fact = { at: now.toISOString(), kind, text }
  list.push(fact)
  // 事实库上限 500 条，超出淘汰最旧的
  while (list.length > 500) list.shift()
  await atomicWrite(facts, JSON.stringify(list, null, 2) + '\n')
  return fact
}

export async function getFacts(whaleHome, limit = 10) {
  const { facts } = memoryFiles(whaleHome)
  const list = await readJson(facts, [])
  return list.slice(-limit)
}

// 唤醒时的记忆上下文：最近的日记小节 + 最新事实
export async function recallContext(whaleHome, { factLimit = 5 } = {}) {
  const { diary } = memoryFiles(whaleHome)
  let recent = ''
  try {
    const text = await readFile(diary, 'utf8')
    const sections = text.split(/^## /m).filter(Boolean)
    recent = sections.slice(-2).map((s) => '## ' + s.trim()).join('\n\n')
  } catch {}
  const facts = await getFacts(whaleHome, factLimit)
  const parts = []
  if (recent) parts.push(`最近日记：\n${recent}`)
  if (facts.length) parts.push(`长期记忆：\n${facts.map((f) => `- [${f.kind}] ${f.text}`).join('\n')}`)
  return parts.join('\n\n')
}
