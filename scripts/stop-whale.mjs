// 一键停止鲸生：DSH（--profile whale 的 node 进程）+ NapCat/QQ（本仓库路径的进程）。
// 只按命令行特征精确匹配——绝不动用户自己的 QQ 或其他 node 程序。
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

console.log('[1/2] 停止 DSH（--profile whale）…')
try {
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" | `
    + `Where-Object { $_.CommandLine -like '*--profile*whale*' -and $_.CommandLine -notlike '*stop-whale*' } | `
    + 'ForEach-Object { "$($_.ProcessId) $($_.Name)" }'], { timeout: 15_000 })
  const rows = stdout.trim().split('\n').filter((l) => /^\d+/.test(l.trim()))
  if (!rows.length) {
    console.log('  DSH 未在运行。')
  } else {
    const pids = rows.map((l) => Number(l.trim().split(/\s+/)[0])).filter((n) => n > 0)
    await execFileAsync('powershell', ['-NoProfile', '-Command',
      `Stop-Process -Id ${pids.join(',')} -Force -ErrorAction SilentlyContinue`], { timeout: 15_000 })
    console.log(`  已停止 ${pids.length} 个进程（${pids.join(', ')}）`)
  }
} catch (e) {
  console.log(`  DSH 停止失败：${e.message}`)
}

console.log('[2/2] 停止 NapCat / QQ（本仓库路径的）…')
const { createNapCatBoot } = await import('../src/platforms/qq/boot.js')
const boot = createNapCatBoot({ log: () => {} })
const r = await boot.stop()
console.log(r.error ? `  失败：${r.error}` : `  已停止 ${r.stopped} 个进程。`)

console.log('鲸生已沉睡 🐋💤（重新唤醒：双击 start-whale.cmd）')
