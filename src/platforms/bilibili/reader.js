// B站只读操作：登录态检查、动态流、视频信息、搜索、buvid 预热。
// 端点语义来自 bilibili-API-collect 社区文档；调用全部经过 api.js 的保护层。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function cookieHeader(credentials) {
  return {
    'user-agent': UA,
    referer: 'https://www.bilibili.com/',
    cookie: `SESSDATA=${credentials.sessdata}; bili_jct=${credentials.bili_jct}; buvid3=${credentials.buvid3}`,
  }
}

export function createReader({ client, credentials }) {
  const headers = cookieHeader(credentials)

  return {
    /** 我是谁：mid / 昵称 / 是否登录（nav 同时是 WBI 密钥来源） */
    async nav() {
      return client.apiGet('https://api.bilibili.com/x/web-interface/nav', headers)
    },

    /** 某用户的动态流（登录态下简单可靠；默认取自己） */
    async dynamics({ hostMid, offset = '' } = {}) {
      const url = new URL('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space')
      let mid = hostMid
      if (!mid) {
        const nav = await this.nav()
        if (nav.code !== 0 || !nav.data?.isLogin) return { code: -101, message: '未登录，无法获取动态' }
        mid = String(nav.data.mid)
      }
      url.searchParams.set('host_mid', String(mid))
      if (offset) url.searchParams.set('offset', String(offset))
      return client.apiGet(url.href, headers)
    },

    /** 视频元信息（标题/简介/统计/cid） */
    async video(bvid) {
      const url = new URL('https://api.bilibili.com/x/web-interface/view')
      url.searchParams.set('bvid', String(bvid).replace(/^BV/i, 'BV'))
      return client.apiGet(url.href, headers)
    },

    /** 搜索（需 WBI 签名，client 内自动处理） */
    async search(keyword, { type = 'video', page = 1 } = {}) {
      const url = new URL('https://api.bilibili.com/x/web-interface/search/type')
      url.searchParams.set('keyword', String(keyword))
      url.searchParams.set('search_type', type)
      url.searchParams.set('page', String(page))
      return client.apiGet(url.href, headers)
    },

    /** 未读私信/系统消息概况（M1 只读不回） */
    async sessions() {
      const url = new URL('https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions')
      url.searchParams.set('session_type', '4')
      url.searchParams.set('size', '20')
      return client.apiGet(url.href, headers)
    },
  }
}
