// 一键启动鲸生：她的 QQ 躯体（NapCat 快速登录）+ 她的 DSH profile。
// 个人数据（QQ 号等）运行时从 data/secrets/qq.json 读取，绝不写死。
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 1. 读她的 QQ 号（没有也能跑，只是首次要扫码）
let qqId = ''
try { qqId = String(JSON.parse(await (await import('node:fs/promises')).readFile(path.join(ROOT, 'data/secrets/qq.json'), 'utf8')).selfId ?? '') } catch {}

// 2. 找 NapCat 安装目录（OneKey 产出的 NapCat.<build>.Shell）
let napcatDir = null
const onekeyDir = path.join(ROOT, 'tools/napcat/onekey')
if (existsSync(onekeyDir)) {
  for (const entry of readdirSync(onekeyDir)) {
    if (/^Napcat\..+\.Shell$/i.test(entry) && existsSync(path.join(onekeyDir, entry, 'napcat.bat'))) {
      napcatDir = path.join(onekeyDir, entry)
      break
    }
  }
}

console.log('[1/2] 她的 QQ 躯体（NapCat）…')
const qqRunning = spawnSync('tasklist', ['/FI', 'IMAGENAME eq QQ.exe'], { encoding: 'utf8' }).stdout?.includes('QQ.exe')
if (qqRunning) {
  console.log('  QQ/NapCat 已在运行，跳过。')
} else if (napcatDir) {
  // 注意：OneKey 的 napcat.bat 不转发参数（-q 会被吞掉导致退回二维码模式），
  // 因此直接调用 NapCatWinBootMain.exe 并把 QQ 号作为快速登录参数传入。
  const bootExe = path.join(napcatDir, 'NapCatWinBootMain.exe')
  const args = qqId ? [qqId] : []
  spawn(bootExe, args, { cwd: napcatDir, detached: true, stdio: 'ignore', windowsHide: false }).unref()
  console.log(`  NapCat 启动中（${qqId ? `快速登录 ${qqId}（来自 data/secrets/qq.json）` : '未找到 qq.json，将出二维码，用她的手机 QQ 扫一次'}）。`)
  console.log('  若弹出二维码窗口：用她的手机 QQ 扫码并授权。')
  await new Promise((r) => setTimeout(r, 8000))
} else {
  console.log('  未找到 tools/napcat 下的 NapCat 安装（见 README 的 QQ 接入章节）。')
}

console.log('[2/2] 她的 DSH（浏览器将自动打开界面）…')
const dsh = process.platform === 'win32' ? path.join(ROOT, 'dsh.cmd') : path.join(ROOT, 'dsh.sh')
const child = process.platform === 'win32'
  ? spawn('cmd', ['/c', dsh, '--profile', 'whale'], { cwd: ROOT, stdio: 'inherit' })
  : spawn(dsh, ['--profile', 'whale'], { cwd: ROOT, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
