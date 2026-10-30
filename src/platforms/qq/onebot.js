// OneBot v11 事件归一化：纯函数，便于单独验证。
// 改编自 dsh-whale-notify（MIT © Lenai）：自己发的消息不回灌、
// CQ 码与段数组两种消息形态、@我检测、图片计数。

/** 提取消息文本（段数组 / CQ 字符串 / 纯文本）。 */
export function extractMessageText(message) {
  if (typeof message === 'string') {
    return message
      .replace(/\[CQ:image[^\]]*\]/g, '[图片]')
      .replace(/\[CQ:at,qq=([0-9]+)[^\]]*\]/g, '@$1 ')
      .replace(/\[CQ:[^\]]*\]/g, '')
      .trim()
  }
  if (Array.isArray(message)) {
    return message
      .map((seg) => {
        if (seg?.type === 'text') return seg.data?.text ?? ''
        if (seg?.type === 'at') return seg.data?.qq === 'all' ? '@全体成员 ' : `@${seg.data?.qq ?? ''} `
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

/** 群消息是否 @ 了自己（selfId 缺失时退化为「@ 了某人」）。 */
export function isAtMe(segments, selfId) {
  if (!Array.isArray(segments)) return false
  return segments.some((seg) => {
    if (seg?.type !== 'at') return false
    const qq = seg.data?.qq
    if (qq === 'all' || qq === undefined) return false
    return selfId === undefined ? true : String(qq) === String(selfId)
  })
}

function countSegments(message, type) {
  if (!Array.isArray(message)) return 0
  return message.filter((seg) => seg?.type === type).length
}

/**
 * 归一化一条 OneBot 事件为鲸生内部消息形状。
 * 心跳/生命周期/自己发的消息返回 undefined。
 * @returns {{type:'private'|'group', userId, groupId?, messageId?, senderName?, text, atMe, isReply, images} | undefined}
 */
export function normalizeOneBotMessage(payload, fallbackSelfId) {
  if (!payload || payload.post_type !== 'message') return undefined
  const selfId = payload.self_id ?? fallbackSelfId
  if (selfId !== undefined && String(payload.user_id) === String(selfId)) return undefined

  const messageType = payload.message_type === 'group' ? 'group' : 'private'
  const message = payload.message
  const text = extractMessageText(message)
  const images = countSegments(message, 'image')
  if (text === '' && images === 0) return undefined

  const segments = Array.isArray(message) ? message : []
  // 捕获 mface（QQ 表情包）段，供贴纸库存档
  const mfaces = segments.filter((seg) => seg?.type === 'mface' || seg?.type === 'bface')
    .map((seg) => ({ type: seg.type, data: { ...seg.data } }))
  return {
    type: messageType,
    userId: payload.user_id,
    groupId: messageType === 'group' ? payload.group_id : undefined,
    messageId: payload.message_id,
    senderName: payload.sender?.card || payload.sender?.nickname || undefined,
    text: text === '' ? (mfaces.length ? `[表情包${mfaces.length > 1 ? `×${mfaces.length}` : ''}]` : `[图片${images > 1 ? `×${images}` : ''}]`) : text,
    atMe: messageType === 'group' && isAtMe(segments, selfId),
    isReply: messageType === 'group' && segments.some((seg) => seg?.type === 'reply'),
    images,
    mfaces,
  }
}

/** OneBot id 归一化：数字/字符串/数字串，发送时尽量转数字。 */
export function normalizeId(value) {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? Number(text) : text
}
