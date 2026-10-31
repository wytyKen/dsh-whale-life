// NapCat 进程管理：查找安装、启动（快速登录）、精确查杀、登录二维码定位。
// QQNT 没有「账号密码登录」这条协议路径——登录只有扫码 / 快速登录（本机登录态）两种，
// 本模块的职责就是让这两种路径在设置页里一键可达：
//   start()    → 快速登录（登录态有效时全自动连上，无需扫码）
//   restart()  → 杀掉重来（二维码过期/进程卡死时拿一张新码）
//   qrcode()   → NapCat 写在缓存里的登录二维码（前端内嵌显示，用户不必找文件）
// 查杀只匹配本仓库 tools/napcat 路径下启动的进程——绝不碰用户自己的 QQ。

import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// ── 安装定位 ──────────────────────────────────────────
export function findNapCatShell(root = PLUGIN_ROOT) {
  const onekeyDir = path.join(root, 'tools', 'napcat', 'onekey')
  try {
    for (const entry of readdirSync(onekeyDir)) {
      if (/^Napcat\..+\.Shell$/i.test(entry) && existsSync(path.join(onekeyDir, entry, 'NapCatWinBootMain.exe'))) {
        return path.join(onekeyDir, entry)
      }
    }
  } catch { /* 目录不存在 = 未安装 */ }
  return null
}

// 登录二维码：versions/<build>/resources/app/napcat/cache/qrcode.png
export function findQrCodeFile(root = PLUGIN_ROOT) {
  const shellDir = findNapCatShell(root)
  if (!shellDir) return null
  try {
    const versionsDir = path.join(shellDir, 'versions')
    for (const build of readdirSync(versionsDir)) {
      const f = path.join(versionsDir, build, 'resources', 'app', 'napcat', 'cache', 'qrcode.png')
      if (existsSync(f)) return f
    }
  } catch { /* versions 缺失 = 未完整安装 */ }
  return null
}

// ── 进程检测 ──────────────────────────────────────────
async function tasklistHas(imageName) {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`])
    return stdout.includes(imageName)
  } catch { return false }
}

// 找出本仓库 NapCat 拉起的进程 PID（QQ.exe + NapCatWinBootMain.exe）。
// 按命令行/可执行路径匹配安装目录（反斜杠与正斜杠两种形式都查）——
// 用户自己开的 QQ 绝不会命中。
async function findOwnPids(shellDir) {
  const esc = (s) => s.replaceAll("'", "''")
  const winPath = esc(shellDir)
  const posixPath = esc(shellDir.replaceAll('\\', '/'))
  const psScript =
    `Get-CimInstance Win32_Process -Filter "Name='QQ.exe' OR Name='NapCatWinBootMain.exe'" | `
    + `Where-Object { ($_.CommandLine -like '*${winPath}*' -or $_.CommandLine -like '*${posixPath}*' -or $_.ExecutablePath -like '*${winPath}*') } | `
    + 'ForEach-Object { $_.ProcessId }'
  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', psScript], { timeout: 15_000 })
    return stdout.split(/\s+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0)
  } catch { return [] }
}

/**
 * NapCat 启动器（一个实例管理一个安装目录）。
 * 所有方法幂等、不抛异常（返回 { error } 形式），供 HTTP 路由直接使用。
 */
export function createNapCatBoot({ root = PLUGIN_ROOT, log = () => {} } = {}) {
  async function isRunning() {
    const shellDir = findNapCatShell(root)
    if (!shellDir) return { running: false, installed: false }
    // 快查先行：没有 QQ.exe 就不用起 PowerShell 精查（后者要 1-2s）
    if (!(await tasklistHas('QQ.exe')) && !(await tasklistHas('NapCatWinBootMain.exe'))) {
      return { running: false, installed: true, shellDir }
    }
    const pids = await findOwnPids(shellDir)
    return { running: pids.length > 0, installed: true, shellDir, pids }
  }

  /**
   * 启动 NapCat（快速登录）。已在跑时是 no-op。
   * 控制台输出（登录流程/错误）追加到 data/napcat-console.log——诊断不再靠猜。
   * @param {string|number} qqId - 快速登录账号；登录态失效时 NapCat 自动落到二维码模式
   */
  async function start(qqId) {
    const info = await isRunning()
    if (!info.installed) return { error: '未找到 NapCat 安装（tools/napcat/onekey/ 下没有 NapCat.*.Shell）' }
    if (info.running) return { started: false, reason: 'already-running' }
    const args = qqId ? [String(qqId)] : []
    try {
      const fs = await import('node:fs')
      fs.mkdirSync(path.join(root, 'data'), { recursive: true })
      const logPath = path.join(root, 'data', 'napcat-console.log')
      // Windows 上 detached 子进程的 stdio 必须是同步打开的整数 fd（流不行）
      const logFd = fs.openSync(logPath, 'a')
      fs.writeSync(logFd, `\n===== ${new Date().toISOString()} 启动 =====\n`)
      spawn(path.join(info.shellDir, 'NapCatWinBootMain.exe'), args, {
        cwd: info.shellDir, detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true,
      }).unref()
      log(`NapCat 启动中（${qqId ? `快速登录 ${qqId}` : '将出二维码'}，无窗口；日志 → data/napcat-console.log，二维码 → 设置页）`)
      return { started: true }
    } catch (e) {
      return { error: `启动失败：${e?.message ?? e}` }
    }
  }

  /** 杀掉本仓库的 NapCat/QQ（只杀自己路径的，用户自己的 QQ 不受影响）。 */
  async function stop() {
    const info = await isRunning()
    if (!info.running) return { stopped: 0 }
    try {
      await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `Stop-Process -Id ${info.pids.join(',')} -Force -ErrorAction SilentlyContinue`,
      ], { timeout: 15_000 })
      log(`NapCat 已停止（${info.pids.length} 个进程）`)
      return { stopped: info.pids.length }
    } catch (e) {
      return { error: `停止失败：${e?.message ?? e}` }
    }
  }

  /** 重启登录流程 = 杀 + 起。二维码过期/登录卡死时用这个拿一张新码。 */
  async function restart(qqId) {
    const stopped = await stop()
    if (stopped.error) return stopped
    await new Promise((r) => setTimeout(r, 2000)) // 等端口与互斥锁释放
    return start(qqId)
  }

  /**
   * 二维码状态（供前端决定是否内嵌显示、是否提示过期）。
   * 返回 { file, mtimeMs, ageMs, stale }；没有码时 available=false。
   */
  function qrcode() {
    const file = findQrCodeFile(root)
    if (!file) return { available: false }
    try {
      const st = statSync(file)
      const ageMs = Date.now() - st.mtimeMs
      // QQ 二维码有效期约 2 分钟；超过视为 stale（前端提示刷新）
      return { available: true, file, mtimeMs: st.mtimeMs, ageMs, stale: ageMs > 120_000 }
    } catch {
      return { available: false }
    }
  }

  return { isRunning, start, stop, restart, qrcode }
}
