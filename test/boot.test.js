// NapCat 进程管理模块：安装定位与二维码定位的纯文件系统逻辑。
// （进程检测/启动/查杀依赖真实 Windows 进程，不做单元测试，走实机验证。）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findNapCatShell, findQrCodeFile, createNapCatBoot } from '../src/platforms/qq/boot.js'

function fakeInstall(root) {
  // 伪造 OneKey 安装结构：tools/napcat/onekey/NapCat.52230.Shell/
  const shell = path.join(root, 'tools', 'napcat', 'onekey', 'NapCat.52230.Shell')
  mkdirSync(shell, { recursive: true })
  writeFileSync(path.join(shell, 'NapCatWinBootMain.exe'), '') // 存在即可
  return shell
}

test('findNapCatShell：定位 NapCat.*.Shell；无安装返回 null', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wl-boot-'))
  try {
    assert.equal(findNapCatShell(root), null, '空目录应返回 null')
    const shell = fakeInstall(root)
    assert.equal(findNapCatShell(root), shell)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('findQrCodeFile：定位 versions/<build>/.../cache/qrcode.png', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wl-boot-'))
  try {
    assert.equal(findQrCodeFile(root), null, '无安装时无二维码')
    fakeInstall(root)
    const qr = path.join(root, 'tools', 'napcat', 'onekey', 'NapCat.52230.Shell',
      'versions', '9.9.33-52230', 'resources', 'app', 'napcat', 'cache', 'qrcode.png')
    mkdirSync(path.dirname(qr), { recursive: true })
    writeFileSync(qr, 'fake-png')
    assert.equal(findQrCodeFile(root), qr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('qrcode()：available/ageMs 字段；文件消失时 available=false', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wl-boot-'))
  try {
    fakeInstall(root)
    const qr = path.join(root, 'tools', 'napcat', 'onekey', 'NapCat.52230.Shell',
      'versions', '9.9.33-52230', 'resources', 'app', 'napcat', 'cache', 'qrcode.png')
    mkdirSync(path.dirname(qr), { recursive: true })
    writeFileSync(qr, 'fake-png')
    const boot = createNapCatBoot({ root })
    const st = boot.qrcode()
    assert.equal(st.available, true)
    assert.ok(st.mtimeMs > 0)
    assert.ok(st.ageMs >= 0)
    assert.equal(st.stale, false, '刚写的文件不应判定过期')
    rmSync(qr)
    assert.equal(boot.qrcode().available, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('start/restart 在未安装时返回 { error } 而非抛异常', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wl-boot-'))
  try {
    const boot = createNapCatBoot({ root })
    assert.match((await boot.start(12345)).error, /未找到 NapCat 安装/)
    // restart 内部 stop 对未运行是 no-op，随后 start 报未安装
    assert.match((await boot.restart(12345)).error, /未找到 NapCat 安装/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
