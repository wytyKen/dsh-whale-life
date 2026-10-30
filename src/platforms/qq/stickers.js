// 贴纸系统：模型用 [贴纸:表情名] 引用，本模块转换为 OneBot 图片段发送。
// 素材来源：whale-musume（MIT © Sutera-Diffusus）的 92 张立绘。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SPRITE_DIR = path.join(PLUGIN_ROOT, 'assets', 'whale-musume-sprites')

// ── 贴纸索引：人类可读名 → 文件名 ──────────────────────
const STICKER_MAP = {
  // 情绪
  '开心': 'dsh-whale-state-celebrate', '庆祝': 'dsh-whale-state-celebrate',
  '好奇': 'dsh-whale-state-curious',   '疑问': 'dsh-whale-meme-doubt',
  '生气': 'dsh-whale-state-angry',     '哼': 'dsh-whale-state-angry',
  '脸红': 'dsh-whale-state-blush',     '害羞': 'dsh-whale-state-blush',
  '大哭': 'dsh-whale-meme-cry',        '哭': 'dsh-whale-meme-cry',
  '震惊': 'dsh-whale-meme-omg',        '哇': 'dsh-whale-meme-omg',
  '得意': 'dsh-whale-meme-smug',       '嘿嘿': 'dsh-whale-meme-smug',
  '破防': 'dsh-whale-meme-broke',      '裂开': 'dsh-whale-meme-broke',
  '无奈': 'dsh-whale-meme-smile-pain', '苦笑': 'dsh-whale-meme-smile-pain',
  '兴奋': 'dsh-whale-meme-wakuwaku',   '期待': 'dsh-whale-meme-wakuwaku',
  '拜': 'dsh-whale-meme-worship',      '膜拜': 'dsh-whale-meme-worship',
  '好的': 'dsh-whale-meme-yes',        '不行': 'dsh-whale-meme-no',
  '酷': 'dsh-whale-state-cool-shades', '酷炫': 'dsh-whale-state-cool-shades',
  'doge': 'dsh-whale-meme-doge',       '滑稽': 'dsh-whale-meme-doge',
  '开心到模糊': 'dsh-whale-daily-melt', '融化': 'dsh-whale-daily-melt',
  '爱心': 'dsh-whale-meme-heart',      '心动': 'dsh-whale-meme-kyun',
  '眨眼': 'dsh-whale-state-wink',      '星星眼': 'dsh-whale-state-star',
  '叉腰': 'dsh-whale-state-bold',      '自信': 'dsh-whale-state-bold',
  // 日常
  '吃': 'dsh-whale-daily-eat',         '吃东西': 'dsh-whale-daily-eat',
  '喝咖啡': 'dsh-whale-daily-coffee',  '咖啡': 'dsh-whale-daily-coffee',
  '做饭': 'dsh-whale-daily-cooking',   '游戏': 'dsh-whale-daily-gaming',
  '画画': 'dsh-whale-daily-painting',  '伸懒腰': 'dsh-whale-daily-stretch',
  '睡觉': 'dsh-whale-state-sleep',     '晚安': 'dsh-whale-state-night',
  '摸鱼': 'dsh-whale-daily-fishing',   '冲浪': 'dsh-whale-state-running',
  // 工作/学习
  '思考': 'dsh-whale-state-thinking',  '想': 'dsh-whale-state-thinking',
  '灵感': 'dsh-whale-work-idea',       '开会': 'dsh-whale-work-meeting',
  '修bug': 'dsh-whale-work-debug',     '上线': 'dsh-whale-work-deploy',
  '赶工': 'dsh-whale-work-deadline',   '摸手机': 'dsh-whale-work-slack-phone',
  '摸头': 'dsh-whale-work-pat',        '被摸头': 'dsh-whale-work-pat',
  // 成就
  '成功': 'dsh-whale-state-success',   '失败': 'dsh-whale-state-failure',
  '升级': 'dsh-whale-state-levelup',   '成就': 'dsh-whale-state-achievement',
  '打招呼': 'dsh-whale-state-greet',   '你好': 'dsh-whale-state-greet',
  '等待': 'dsh-whale-state-waiting',   '发呆': 'dsh-whale-state-abstract',
  // 天气/节日
  '下雨': 'dsh-whale-weather-rain-happy', '冷': 'dsh-whale-weather-cold',
  '下雪': 'dsh-whale-weather-snow',    '打雷': 'dsh-whale-weather-thunder',
}

// ── 解析模型输出中的贴纸引用 ──────────────────────────
// 返回 { text: '去掉贴纸引用后的纯文本', stickers: [{file, name}] }
export function parseStickers(rawText) {
  const stickers = []
  const pattern = /\[贴纸[：:]([^\]]+)\]/g
  let text = rawText
  let match
  while ((match = pattern.exec(rawText)) !== null) {
    const name = match[1].trim()
    const fileBase = STICKER_MAP[name]
    if (fileBase) {
      const filePath = path.join(SPRITE_DIR, `${fileBase}.webp`)
      if (existsSync(filePath)) {
        stickers.push({ file: filePath, name })
        text = text.replace(match[0], '') // 从文本中去掉贴纸标记
      }
    }
  }
  return { text: text.replace(/\s{2,}/g, ' ').trim(), stickers }
}

// ── QQ 表情包（mface）库 ─────────────────────────────────
// 从收到的消息自动捕获，或手动在 data/<whale>/mface-library.json 配置

import { readFile, writeFile, mkdir } from 'node:fs/promises'

export function createMfaceLibrary(libraryFile) {
  async function load() {
    try { return JSON.parse(await readFile(libraryFile, 'utf8')) } catch { return {} }
  }
  async function save(data) {
    await mkdir(path.dirname(libraryFile), { recursive: true })
    await writeFile(libraryFile, JSON.stringify(data, null, 2) + '\n')
  }
  return {
    /** 从收到的消息捕获表情包元数据，返回新增数量 */
    async capture(mfaces, senderName) {
      if (!mfaces?.length) return 0
      const lib = await load()
      let added = 0
      for (const mf of mfaces) {
        const key = mf.data?.emoji_id ?? mf.data?.face_id ?? JSON.stringify(mf.data).slice(0, 60)
        if (!lib[key]) {
          // 用 summary 做人可读名，去重后缀
          const rawName = (mf.data?.summary ?? '').replace(/^\[|\]$/g, '') || `表情${Object.keys(lib).length + 1}`
          lib[key] = {
            name: rawName,
            type: mf.type,
            data: { ...mf.data },
            capturedFrom: senderName ?? 'unknown',
            capturedAt: new Date().toISOString(),
          }
          added++
        }
      }
      if (added > 0) await save(lib)
      return added
    },

    /** 按名查找 */
    async find(name) {
      const lib = await load()
      const entry = Object.values(lib).find((e) => e.name === name || e.name.includes(name))
      return entry ?? null
    },

    /** 列出所有已捕获的表情包名 */
    async listNames() {
      const lib = await load()
      return Object.values(lib).map((e) => e.name)
    },
  }
}

// ── 解析模型输出中的 QQ 表情包引用 ─────────────────────
// 返回 { text: 纯文本, mfaceRefs: [名字] }
export function parseMfaceRefs(rawText) {
  const refs = []
  const pattern = /\[表情[：:]([^\]]+)\]/g
  let text = rawText
  let match
  while ((match = pattern.exec(rawText)) !== null) {
    refs.push(match[1].trim())
    text = text.replace(match[0], '')
  }
  return { text: text.replace(/\s{2,}/g, ' ').trim(), mfaceRefs: refs }
}

// ── 生成可用的贴纸清单（注入启动提示词）──────────────────
export function stickerCatalogPreview(mfaceNames = []) {
  const spriteNames = [...new Set(Object.keys(STICKER_MAP))]
  let catalog = `你可以在回复中使用以下方式发送表情：\n`
  catalog += `1. [贴纸:表情名] — 发送鲸鱼娘立绘（${spriteNames.slice(0, 15).join('、')} 等共 ${spriteNames.length} 个）\n`
  if (mfaceNames.length > 0) {
    catalog += `2. [表情:名字] — 发送QQ表情包（${mfaceNames.slice(0, 15).join('、')} 等共 ${mfaceNames.length} 个）\n`
  } else {
    catalog += `2. [表情:名字] — 发送QQ表情包（暂无库存；有人发给你表情包时会自动收录）\n`
  }
  catalog += `3. Unicode emoji（😄🎉 等）直接输入即可`
  return catalog
}

// ── 构建 OneBot 消息段（文字 + 图片混合）─────────────────
export function buildMessageSegments(text, stickers) {
  const segments = []
  if (text.trim()) {
    segments.push({ type: 'text', data: { text: text.trim() } })
  }
  for (const s of stickers) {
    segments.push({ type: 'image', data: { file: `file:///${s.file.replace(/\\/g, '/')}` } })
  }
  return segments.length ? segments : [{ type: 'text', data: { text: '…' } }]
}
