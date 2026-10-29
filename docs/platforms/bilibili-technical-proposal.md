# B站 平台技术方案（调研结论 · 2026-10-30）

> 调研目标：鲸鱼娘以真实用户身份运营属于自己的 B站账号。
> 主要依据：bilibili-API-collect（BAC）社区 fork 文档 + 同场景参照 [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（已验证路线）。
> ⚠️ **重要背景**：BAC 原仓库 2026-01-28 收到 B站委托律所函件后**清空归档**，完整内容存活于社区 fork（[fgott](https://github.com/fgott/bilibili-API-collect_fork)、[alittlehuaji](https://github.com/alittlehuaji/bilibili-api-collect-mirror)、[melon-444](https://github.com/melon-444/bilibili-API-collect-fork) 等）。该事件提示：平台正在法律层面收紧协议化操作。本插件应**控制写频率、不做营销式内容、具体签名算法实现细节以 BAC fork 为准不在本仓库囤积全文**。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 技术路线 | **Cookie 凭据 + Web API 直调，零依赖自建薄客户端（约 500–800 行）**——dsh-bili-whale 已验证可行 |
| 扫码登录 | 纯协议可行：`generate` 出码（180s 有效）→ `poll` 轮询（86101 未扫 / 86090 待确认 / 86038 过期 / 0 成功）→ Set-Cookie 拿全套登录态 |
| 自主注册 | **不可行**（极验点选验证 + 虚拟号段风控 + 发动态强制绑手机）→ 主人预制小号 + 扫码交接凭据，永不传输密码 |
| JS 生态库 | bilibili-api-js 已从 npm unpublish；仅 @renmu/bili-api 活跃但覆盖不全 → 自建最优 |
| 行为预算 | 参照 dsh-bili-whale：全局间隔 600ms、读 ≤3000/天、**写 ≤30/天**、412 分级暂停、指数退避 ≤15 分钟 |
| 审批档 | 四档：live / dry-run（writer 全短路落 outbox）/ audit-only（仅主人可见回复可发）/ frozen（风控触发自动只读） |

## 1. 登录与凭据

**必存凭据清单**（`data/secrets/bili-credentials.json`，0600）：

| 凭据 | 作用 |
|---|---|
| `SESSDATA` | 登录凭证（HttpOnly Cookie） |
| `bili_jct` | CSRF token（所有写操作 `csrf` 来源） |
| `DedeUserID` (+`__ckMd5`) | 自己的 mid |
| `buvid3` / `buvid4` | Web 设备指纹——缺失则发动态异常、搜索 -412；用 `GET /x/frontend/finger/spi` 一次拿全，每账号独享 |
| `b_nut` | 风控时间戳 cookie（建议） |
| `refresh_token` | **Cookie 刷新口令（最易漏存！浏览器里叫 ac_time_value，在 localStorage 不在 Cookie）** |
| `bili_ticket` | JWT，可选，携带可降低风控概率（3 天续期） |

**Cookie 保活**（核心运维）：每日检查 `GET /x/passport-login/web/cookie/info` → 需刷新时走 correspond 页取 `refresh_csrf`（RSA-OAEP 加密推导）→ `POST .../cookie/refresh` 换全套新 Cookie + 新 refresh_token → confirm 旧态失效。Cookie 名义半年，不主动续期则被风控下线即死。

**凭据纪律**：配置与凭据彻底分离；凭据值永不进日志/错误堆栈/LLM 上下文（只暴露"已登录/剩 N 天"）；失败登录不覆盖旧凭据（dsh-bili-whale 做法）。

## 2. 核心操作端点（详见 BAC fork 各文档）

| 操作 | 端点要点 |
|---|---|
| 发动态（图文） | `POST /x/dynamic/feed/create/dyn`（JSON，scene 1 文字/2 图/4 转发，图 ≤9）；图先传 `/x/dynamic/feed/draw/upload_bfs`。未绑手机报 4126021 |
| 读动态 | `GET /x/polymer/web-dynamic/v1/feed/space?host_mid=`（登录态简单可靠） |
| 评论/回复 | `POST /x/v2/reply/add`（≤1000 字，楼中楼带 root/parent）；自己动态的评论 type=17（纯文字）/11（图文）。敏感词 12016、刷屏 12051、需验证码 12015（风控前兆） |
| 私信 | `POST /web_im/v1/web_im/send_msg`（msg[dev_id] 必须为 UUIDv4；content 为 JSON 文本 ≤2000B）。**21047 陌生人只能发一条**——服务端硬限制。收件箱 `get_sessions` |
| 关注 | `POST /x/relation/modify`（act 1 关注/2 取关/5 拉黑）；互关判定 `GET /x/relation`（attribute=6）——私信白名单的依据 |
| 搜索 | `GET /x/web-interface/wbi/search/all/v2`——**必须 WBI 签名 + buvid3 + 正常 Referer/UA**，否则 -412 |
| 视频信息/字幕 | `GET /x/web-interface/view?bvid=`；字幕 `/x/player/wbi/v2`（**必须登录**，否则 subtitles 恒空） |
| WBI 签名 | nav 接口取 img/sub key（每日更替需缓存）→ mixin 混淆取前 32 位 → 参数排序+编码后 MD5 = w_rid。算法细节见 BAC fork `misc/sign/wbi.md` |

## 3. 风控要点

- **gaia 风控（-352 + v_voucher）**：高频/异常触发。正解是**永远别走进去**——触发即熔断当日写操作并通知主人；geetest 为 null 时无法验证码解除只能等
- **环境一致性 > 指纹随机化**：固定一套真实浏览器 UA + 稳定 IP + 全套 cookie；登录前先预热拿 buvid
- **高危排序**：新号广告内容 > 高频写操作 > 同文案批量评论 > 机器作息 > 单 IP 多账号
- **安全实践**（继承 dsh-bili-whale"不做清单"）：不发陌生人私信、不群发、不三连/投币/花钱、不绕风控；行为窗口随机抖动（±20 分钟）、30% 概率当天不营业、新号前两周只读

## 4. 插件集成设计（src/platforms/bilibili/）

```
src/platforms/bilibili/
├── index.js        # registerBilibili(ctx, whale)
├── credentials.js  # data/secrets/bili-credentials.json：加载/原子写回/每日过期检查
├── client.js       # 唯一 HTTP 出口：固定 UA、cookie jar、WBI signer（每日缓存）、buvid 预热、
│                   #   全局 600ms 间隔、错误分类（-101 登录失效/-111 csrf/-352 gaia/-412 拦截）
├── reader.js       # 动态/视频/字幕/搜索/收件箱（只读）
├── writer.js       # 发动态/评论/私信/关注——每函数第一行 approver.check()
├── approver.js     # 四档审批：live/dry-run(outbox pending)/audit-only/frozen
└── qrcode-login.js # 扫码登录流程（宿主命令入口，失败不覆盖旧凭据）
```

**对现有 schema 的影响**：`accounts[].allowRegister` 语义修正为"凭据交接方式"——现实流程是主人预制小号，她发起扫码、主人手机确认即完成移交（调研结论：协议侧自主注册不可行）。

## 5. 里程碑

- **M1 登录态保活 + 只读**：扫码登录落盘 → 每日保活 → 读动态/视频/字幕/搜索（WBI signer 必须完成）。验收：连续 7 天凭据不掉线、零风控
- **M2 发动态**：图文/文字/转发三型，dry-run 起步 + 主人放行
- **M3 评论 + 私信 + 关注**：私信三重硬护栏（仅主人/每日一收信人/必须互关）无论审批档位不放开

## 附：来源

[BAC 原仓库（已归档）](https://github.com/SocialSisterYi/bilibili-API-collect) · [fgott fork](https://github.com/fgott/bilibili-API-collect_fork) · [alittlehuaji 镜像](https://github.com/alittlehuaji/bilibili-api-collect-mirror) · [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) · [@renmu/bili-api](https://github.com/renmu123/biliAPI) · [BiliBiliToolPro#794](https://github.com/RayWangQvQ/BiliBiliToolPro/issues/794) · [bilibili-dynamic-mirai-plugin#111](https://github.com/Colter23/bilibili-dynamic-mirai-plugin/issues/111) · [linux.do 实名讨论](https://linux.do/t/topic/775132)
