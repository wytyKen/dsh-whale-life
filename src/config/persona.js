// 人设解析：空白出生 / 模板人设 / 完全自定义。
// 合并规则：custom 的每个字段覆盖模板同名字段（数组整体替换，不做逐项合并）。

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PERSONAS_DIR = path.join(PLUGIN_ROOT, 'personas')

// 空白出生：不选模板也不自定义时的默认人设——一页空白，等待经历书写
export const BLANK_PERSONA = Object.freeze({
  id: 'blank',
  name: '无名鲸鱼',
  summary: '空白出生。她的性格将由她自己的经历书写。',
  traits: [],
  tone: '',
  exampleLines: [],
  interests: [],
})

export async function listTemplates() {
  if (!existsSync(PERSONAS_DIR)) return []
  const files = await readdir(PERSONAS_DIR)
  return files.filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''))
}

async function loadTemplate(templateId) {
  const file = path.join(PERSONAS_DIR, `${templateId}.yaml`)
  if (!existsSync(file)) {
    return { ok: false, error: `人设模板 '${templateId}' 不存在（personas/ 目录中没有 ${templateId}.yaml）` }
  }
  const raw = await readFile(file, 'utf8')
  const parsed = YAML.parse(raw)
  return { ok: true, value: { id: templateId, ...parsed } }
}

// 输入 persona 配置 { template?, custom? }，输出 { ok, error?, value }
export async function resolvePersona(personaCfg = {}) {
  const { template, custom } = personaCfg

  let base = { ...BLANK_PERSONA }
  if (template !== undefined) {
    if (typeof template !== 'string' || !template) {
      return { ok: false, error: `persona.template 必须是非空字符串` }
    }
    const loaded = await loadTemplate(template)
    if (!loaded.ok) return loaded
    base = { ...base, ...loaded.value }
  }

  if (custom !== undefined) {
    if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) {
      return { ok: false, error: `persona.custom 必须是对象` }
    }
    for (const key of Object.keys(custom)) {
      base[key] = custom[key]
    }
  }

  return { ok: true, value: base }
}
