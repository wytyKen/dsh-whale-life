// 验证严格 JSON 校验是否拒绝 undefined 值
import { pathToFileURL } from 'node:url'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const pnpmDir = 'runtime/node_modules/.pnpm'
let uvDir = null
for (const entry of readdirSync(pnpmDir)) {
  const d = path.join(pnpmDir, entry, 'node_modules/@deepseek-ai/dsh-util-values')
  if (existsSync(path.join(d, 'lib/index.js'))) { uvDir = d; break }
}
const { isJsonValue } = await import(pathToFileURL(uvDir.replaceAll('\\', '/') + '/lib/index.js').href)
console.log('无 undefined   :', isJsonValue({ kind: 'user' }) ? 'OK' : 'FAIL')
console.log('含 undefined   :', isJsonValue({ kind: 'user', rpcId: undefined }) ? 'OK' : 'FAIL ← 就是它!')
console.log('数组含 undefined:', isJsonValue([undefined]) ? 'OK' : 'FAIL')
