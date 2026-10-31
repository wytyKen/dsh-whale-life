// 一键启动鲸生：拉起她的 DSH profile（后台常驻、无弹窗）。
// 她的对话就活在 DSH Web 里——工作区「泠汐」下开新会话即可聊天。
import path from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(ROOT, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

console.log('[1/1] 她的 DSH（后台常驻，不自动弹浏览器）…')
// 直接 spawn node（不经 dsh.cmd 的 cmd /c 层）：进程链更短，stdio 文件句柄可靠继承——
// DSH 的控制台输出（含 Web 认证 URL）全程落盘 data/dsh-console.log。
mkdirSync(path.join(ROOT, 'data'), { recursive: true })
const dshHome = path.join(ROOT, 'dsh-home')
const tmp = path.join(dshHome, 'tmp')
mkdirSync(tmp, { recursive: true })
const dshFd = openSync(path.join(ROOT, 'data', 'dsh-console.log'), 'a')
const child = spawn(process.execPath, [BIN, '--profile', 'whale', '--no-open'], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', dshFd, dshFd],
  env: { ...process.env, DSH_HOME: dshHome, TEMP: tmp, TMP: tmp },
})
child.unref()
setTimeout(() => {
  console.log('  DSH 已后台启动。认证 URL 与日志 → data/dsh-console.log')
  console.log('  管理面板：http://127.0.0.1:3939/settings-page')
  console.log('  停止：双击 stop-whale.cmd')
}, 1500)
