// 临时诊断脚本：离线复现 agent/inbox/spliced 不可序列化问题
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const pnpmDir = path.join(ROOT, 'runtime/node_modules/.pnpm')

function findPkg(name) {
  for (const entry of readdirSync(pnpmDir)) {
    const dir = path.join(pnpmDir, entry, 'node_modules/@deepseek-ai', name)
    if (existsSync(path.join(dir, 'lib/index.js'))) return dir
  }
  throw new Error('not found: ' + name)
}

const llmDir = findPkg('dsh-llm')
const uvDir = findPkg('dsh-util-values')
console.log('dsh-llm   =', llmDir)
console.log('util-vals =', uvDir)

const { createUserMessage } = await import(pathToFileURL(path.join(llmDir, 'lib/index.js')).href)
const { snapshotJsonValue } = await import(pathToFileURL(path.join(uvDir, 'lib/index.js')).href)

const msg = createUserMessage({ content: [{ type: 'text', text: '【醒来】测试' }], source: { kind: 'user' } })
console.log('UserMessage keys:', Object.keys(msg).join(', '))
console.log('source 字段:', JSON.stringify(msg.source))

const event = { target: 'inbox', start: 0, inserted: [msg] }
const snap = snapshotJsonValue(event)
console.log('整事件 snapshot:', snap === undefined ? 'FAILED（复现!）' : 'OK')

if (snap === undefined) {
  for (const [k, v] of Object.entries(msg)) {
    console.log(`  ${k} =>`, snapshotJsonValue(v) === undefined ? '<< 非法字段' : typeof v)
  }
  console.log('  content =>', snapshotJsonValue(msg.content) === undefined ? '<< 非法!' : 'OK')
  if (snapshotJsonValue(msg.content) === undefined) {
    for (const [i, block] of msg.content.entries()) {
      console.log(`    block[${i}] =>`, snapshotJsonValue(block) === undefined ? '<< 非法!' : 'OK', Object.keys(block))
    }
  }
}
