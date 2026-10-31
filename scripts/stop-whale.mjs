// 一键停止鲸生：结束 DSH（--profile whale 的 node 进程）。
// 只按命令行特征精确匹配——绝不动其他 node 程序。
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const execFileAsync = promisify(execFile)

console.log('[1/1] 停止 DSH（--profile whale）…')
try {
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" | `
    + `Where-Object { $_.CommandLine -like '*--profile*whale*' -and $_.CommandLine -notlike '*stop-whale*' } | `
    + 'ForEach-Object { "$($_.ProcessId)" }'], { timeout: 15_000 })
  const pids = stdout.trim().split(/\s+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0)
  if (!pids.length) {
    console.log('  DSH 未在运行。')
  } else {
    await execFileAsync('powershell', ['-NoProfile', '-Command',
      `Stop-Process -Id ${pids.join(',')} -Force -ErrorAction SilentlyContinue`], { timeout: 15_000 })
    console.log(`  已停止 ${pids.length} 个进程（${pids.join(', ')}）`)
  }
} catch (e) {
  console.log(`  停止失败：${e.message}`)
}
console.log('鲸生已沉睡 🐋💤（重新唤醒：双击 start-whale.cmd）')
