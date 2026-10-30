// B站凭据管理：格式校验、注入防护、文件权限、原子写入。
// 改编自 dsh-bili-whale（MIT © Alterssss），按鲸生架构调整：凭据落 data/secrets/。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

export class AuthError extends Error {}

/** 解析并校验 Cookie 三件套；在任何网络请求前先拒绝头部注入。 */
export function parseCookie(input = {}) {
  const pick = (raw, key) => {
    const value = String(raw ?? '').trim()
    const match = value.match(new RegExp('(?:^|;)\\s*' + key + '=([^;]+)', 'i'))
    return (match ? match[1] : value.replace(new RegExp('^' + key + '\\s*=', 'i'), ''))
      .replace(/^["'\s]+|["';\s]+$/g, '').trim()
  }
  const credentials = {
    sessdata: pick(input.sessdata, 'SESSDATA'),
    bili_jct: pick(input.bili_jct, 'bili_jct'),
    buvid3: pick(input.buvid3, 'buvid3'),
  }
  if (credentials.sessdata.length < 20 || credentials.sessdata.length > 8192
    || !/^[0-9a-fA-F]{32}$/.test(credentials.bili_jct)
    || Object.values(credentials).some((value) => /[\r\n;\x00-\x1f\x7f]/.test(value) || value.length > 8192)) {
    throw new AuthError('凭据不完整或格式无效：需要 SESSDATA、bili_jct（32 位十六进制）、buvid3。')
  }
  return credentials
}

/** 文件权限收紧：Windows 走 icacls 只留当前用户，*nix 走 chmod 600。 */
export function protectFile(file) {
  if (process.platform !== 'win32') { fs.chmodSync(file, 0o600); return }
  const options = { encoding: 'utf8', windowsHide: true, timeout: 10000 }
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  const sid = execFileSync(path.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], options)
    .match(/S-1-\d+(?:-\d+)*/)?.[0]
  if (!sid) throw new AuthError('无法确认当前 Windows 用户，未保存凭据。')
  execFileSync(path.join(system, 'icacls.exe'), [file, '/reset', '/Q'], options)
  execFileSync(path.join(system, 'icacls.exe'), [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '/Q'], options)
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export function loadCredentials(file) {
  const text = read(file)
  if (text === null) return null
  return parseCookie(JSON.parse(text.replace(/^\uFEFF/, '')))
}

/** 单写者串行保存：先验证新凭据有效再替换；任何一步失败，旧登录态原样保留。 */
export function createCredentialStore({ file, verify, protect = protectFile }) {
  let tail = Promise.resolve()
  const save = (input, { signal } = {}) => {
    const task = tail.then(async () => {
      const credentials = parseCookie(input)
      const account = await verify(credentials, { signal })
      const oldText = read(file)
      if (signal?.aborted) throw new AuthError('登录已取消，未保存。')
      if (read(file) !== oldText) throw new AuthError('登录态已在别处变化，请重新扫码。')
      const temp = `${file}.${crypto.randomUUID()}.tmp`
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const fd = fs.openSync(temp, 'wx', 0o600)
        try {
          protect(temp)
          fs.writeFileSync(fd, JSON.stringify(credentials, null, 2) + '\n')
          fs.fsyncSync(fd)
        } finally { fs.closeSync(fd) }
        fs.renameSync(temp, file)
      } catch (error) {
        if (error instanceof AuthError) throw error
        throw new AuthError('凭据保存失败，旧登录态未替换；请检查文件权限。')
      } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp)
      }
      return account
    })
    tail = task.catch(() => {})
    return task
  }
  return { save }
}
