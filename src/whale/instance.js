// 鲸鱼实例：数据目录管理与生命体征输出。
// 目录布局（PLUGIN_ROOT/data/，已 git 忽略）：
//   data/<whale-id>/memory/     她的记忆
//   data/<whale-id>/logs/       她的行为日志与时间线
//   data/<whale-id>/identity/   形象资料（头像等）
//   data/secrets/               全部账号凭据（加密存储，永不提交）

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export function dataRoot(root = PLUGIN_ROOT) {
  return path.join(root, 'data')
}

export async function ensureWhaleDirs(whaleId, root = PLUGIN_ROOT) {
  const home = path.join(dataRoot(root), whaleId)
  for (const dir of ['memory', 'logs', 'identity']) {
    await mkdir(path.join(home, dir), { recursive: true })
  }
  await mkdir(path.join(dataRoot(root), 'secrets'), { recursive: true })
  return home
}

// 一行生命体征：她醒来时向主人报到
export function vitalsLine(whale, persona) {
  const platforms = whale.accounts.length
    ? whale.accounts.map((a) => a.platform).join('/')
    : '无账号'
  const approval = { auto: '全自主', semi: '高危请示', 'dry-run': '试运行' }[whale.approvalMode]
  const cronCount = whale.rhythm.cron.length
  return `🐋 #${whale.id}「${persona.name}」已就绪 —— 人设:${persona.id} | 平台:${platforms} | 审批:${approval} | 定时任务:${cronCount} 项 | 时区:${whale.rhythm.timezone}`
}
