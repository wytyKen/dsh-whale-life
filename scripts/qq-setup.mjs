// qq setup：新用户一键接入向导（cli.mjs qq setup 调用）。
// 自动做：连接配置生成（随机 token）→ NapCat 缺失时下载 OneKey 引导安装 →
// 网络配置写入 → 引导扫码。每一步失败都降级为清晰的手动指引。
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAPCAT_ROOT = path.join(ROOT, 'tools', 'napcat')
const SECRETS = path.join(ROOT, 'data', 'secrets')
const QQ_JSON = path.join(SECRETS, 'qq.json')

const ask = (q) => new Promise((r) => {
  process.stdout.write(q)
  process.stdin.once('data', (d) => r(d.toString().trim()))
})
const step = (n, total, msg) => console.log(`[${n}/${total}] ${msg}`)

function findNapCat() {
  const onekey = path.join(NAPCAT_ROOT, 'onekey')
  if (!existsSync(onekey)) return null
  for (const entry of readdirSync(onekey)) {
    if (/^Nap[Cc]at\..+\.Shell$/i.test(entry) && existsSync(path.join(onekey, entry, 'napcat.bat'))) {
      return path.join(onekey, entry)
    }
  }
  return null
}

export async function qqSetup() {
  const TOTAL = 4

  // 1. 连接配置
  step(1, TOTAL, '连接配置 data/secrets/qq.json …')
  let config = null
  try { config = JSON.parse(readFileSync(QQ_JSON, 'utf8')) } catch {}
  if (!config) {
    mkdirSync(SECRETS, { recursive: true })
    const selfId = await ask('  她的 QQ 号（直接回车可跳过，登录后再补）：')
    config = {
      httpBase: 'http://127.0.0.1:3000',
      wsPort: 3001,
      accessToken: crypto.randomBytes(24).toString('hex'),
      ...(selfId && /^\d+$/.test(selfId) ? { selfId: Number(selfId) } : {}),
    }
    writeFileSync(QQ_JSON, JSON.stringify(config, null, 2) + '\n')
    console.log('  ✓ 已生成（token 已随机创建，文件已加进 gitignore 的 data/ 下）')
  } else {
    console.log('  ✓ 已存在，跳过')
  }

  // 2. NapCat
  step(2, TOTAL, 'NapCat 安装检查 …')
  let napcat = findNapCat()
  if (!napcat) {
    mkdirSync(NAPCAT_ROOT, { recursive: true })
    const zip = path.join(NAPCAT_ROOT, 'onekey.zip')
    const NAPCAT_RELEASE = 'https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.Windows.OneKey.zip'
    console.log('  未安装。下载 OneKey 引导包（约 1MB）…')
    try {
      const res = await fetch(NAPCAT_RELEASE, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await pipeline(res.body, createWriteStream(zip))
      execSync(`powershell -Command "Expand-Archive -Force '${zip}' '${path.join(NAPCAT_ROOT, 'onekey')}'"`, { stdio: 'ignore' })
      console.log('  ✓ OneKey 已就绪。现在启动安装器窗口（会自动下载 QQ）…')
      spawn('cmd', ['/c', 'start', '', path.join(NAPCAT_ROOT, 'onekey', 'NapCatInstaller.exe')], { detached: true, stdio: 'ignore' }).unref()
      console.log('  ⚠ 请在弹出的安装器中完成安装（若可选目录，选到 tools/napcat/ 下）。等待安装完成（最多 10 分钟）…')
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 10_000))
        napcat = findNapCat()
        if (napcat) break
        if (i % 6 === 5) console.log(`  … 仍在等待（${(i + 1) * 10}s）`)
      }
    } catch (e) {
      console.log(`  ✗ 下载失败：${e.message}`)
      console.log('  手动方案：到 https://github.com/NapNeko/NapCatQQ/releases 下载 NapCat.Shell.Windows.OneKey.zip，')
      console.log(`  解压到 ${path.join(NAPCAT_ROOT, 'onekey')} 后运行其中的 NapCatInstaller.exe，然后重跑本命令。`)
    }
  }
  if (napcat) console.log(`  ✓ NapCat：${napcat}`)

  // 3. 网络配置（预置：登录时 NapCat 会读取 onebot11_<QQ>.json）
  step(3, TOTAL, 'NapCat 网络配置（HTTP 3000 + 反向 WS 3001）…')
  if (napcat && config.selfId) {
    try {
      const versionsDir = path.join(napcat, 'versions')
      const build = readdirSync(versionsDir).find((d) => /^\d+\.\d+/.test(d))
      const cfgDir = build && path.join(versionsDir, build, 'resources', 'app', 'napcat', 'config')
      if (cfgDir) {
        mkdirSync(cfgDir, { recursive: true })
        const cfgFile = path.join(cfgDir, `onebot11_${config.selfId}.json`)
        writeFileSync(cfgFile, JSON.stringify({
          network: {
            httpServers: [{ name: 'whale-life-http', enable: true, port: 3000, host: '127.0.0.1', enableCors: false, enableWebsocket: false, messagePostFormat: 'array', token: config.accessToken, debug: false }],
            httpSseServers: [], httpClients: [], websocketServers: [],
            websocketClients: [{ name: 'whale-life-ws', enable: true, url: `ws://127.0.0.1:${config.wsPort}`, messagePostFormat: 'array', reportSelfMessage: false, reconnectInterval: 5000, token: config.accessToken, debug: false, heartInterval: 30000 }],
            plugins: [],
          },
          musicSignUrl: '', enableLocalFile2Url: false, parseMultMsg: false,
          timeout: { baseTimeout: 10000, uploadSpeedKBps: 256, downloadSpeedKBps: 256, maxTimeout: 1800000 },
        }, null, 2) + '\n')
        console.log('  ✓ 已预置（登录后自动生效）')
      }
    } catch (e) {
      console.log(`  ⚠ 预置失败（可登录后在 WebUI 手动配）：${e.message}`)
    }
  } else if (!config.selfId) {
    console.log('  ⚠ qq.json 没有 selfId，跳过预置——首次扫码登录后，把她的 QQ 号补进 qq.json 再重跑本命令。')
  }

  // 4. 登录引导
  step(4, TOTAL, '启动她的 QQ 躯体（扫码登录）…')
  console.log('\n全部就绪。接下来：')
  console.log('  1) 双击 start-whale.cmd（或 node scripts/start-whale.mjs）——NapCat 出二维码时用她的手机 QQ 扫一次')
  console.log('  2) 验证：node cli.mjs qq status（应返回她的 QQ 号与昵称）')
  console.log('  3) 在 DSH 配置里给她的账号加 platform: qq，重启 DSH，私聊她试试')
  console.log('\n详细文档：docs/platforms/qq-technical-proposal.md 与 README 的 QQ 接入章节。')
}
