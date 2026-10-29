# QQ 平台技术方案（调研结论 · 2026-10-30）

> 调研目标：为鲸生选定「AI 鲸鱼娘以真实 QQ 用户身份运营独立账号」的协议端与集成方案。
> 排除项：官方 QQ Bot 开放平台（挂在特定账号消息列表上，非独立账号，已明确不采用）。
> 所有关键结论附来源；社区经验与无法交叉验证的信息标注【未验证】。

## 0. 结论速览

1. **协议端选 NapCat**：2026-10 仍极活跃（单月 10 个版本），无头运行 50–100 MB，全平台 + Docker，OneBot 11 完整实现 + 人设向扩展 API（`set_qq_avatar` 换头像 / `set_self_longnick` 改签名 / `set_online_status` / `friend_poke` 戳一戳 / `set_group_sign` 群签到——"像活人"的低成本表达）。
2. **能力面**：私聊/群聊收发、好友请求处理（只能被动接受/拒绝，**主动加好友无 API**）、群管理、资料读取；**QQ 空间发说说完全无协议侧支持**——用"改签名+换头像+在线状态"轻动态降级，Qzone Web 旁路（aioqzone 生态）作为默认关闭的可选模块。
3. **账号存活纪律**：专用小号（绝不用主人号）、占 PC 端登录位（期间不得在任何 PC 登录同号）、固定设备与 IP、消息间隔 ≥3s + 抖动、不秒回不群发；新号直接挂协议端社区共识"基本秒封"【未验证】，建议先手机正常使用 1–2 周。
4. **桥接**：正向 WebSocket（NapCat 起 WS 服务端，插件做 client 连 `ws://127.0.0.1:3001`）+ token 鉴权 + 心跳监测（错过 3 个即降级）+ 指数退避重连；NapCat **独立进程部署**，登录态生命周期与插件解耦。
5. **风险定性**：全行业（骰子/群聊 bot）运行多年的灰色路线，存在周期性打击波（2025 年中一轮）；最坏情况是牺牲小号。对"个人养一只电子生命"值得做，对"7×24 可靠服务"不值得期待。

## 1. 协议端对比（为什么是 NapCat）

| 维度 | NapCat ★ | LLBot（原 LLOneBot） | Lagrange.Core |
|---|---|---|---|
| 原理 | 官方 NTQQ 客户端无头化 | 已转型纯协议服务端 | NTQQ 纯 C# 协议实现 |
| 活跃度（2026-10） | 极活跃，约每 1–2 天一版 | 活跃，生态重建中 | 承压，nightly 停更【未验证】 |
| 命门 | 依赖 QQ 客户端版本匹配 | 转型期风险 | **签名服务已拉闸**（社区反馈） |
| 扩展 API | 人设向最丰富 | 一般 | 一般 |

关键背景：纯协议路线（Lagrange/LLBot）共同命门是签名服务存亡；NapCat 跑官方客户端本体，签名由官方消化——这是它成为事实主流的根本原因。备选退路：坚持 OneBot 11 抽象层，NapCat 停摆时 LLBot/Lagrange.OneBot 即插即换。

来源：[NapCat](https://github.com/NapNeko/NapCatQQ) · [LLBot](https://github.com/LLOneBot/LLOneBot) · [Lagrange](https://github.com/LagrangeDev/Lagrange.Core) · [海豹骰部署文档](https://docs.sealdice.com/deploy/platform-qq.html) · [LiteLoaderQQNT#1063](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT/issues/1063)

## 2. OneBot 11 能力面（标准已逐条核对）

- 消息：`send_private_msg` / `send_group_msg` / 撤回 / 合并转发；消息段支持文本/图/语音/@/回复等
- 好友：`get_friend_list`、`set_friend_add_request`（同意/拒绝请求）、`send_like`（名片点赞 10 次/天）
- 群：成员/信息读取、禁言/踢人/改名片、`set_group_add_request`
- 账号：`get_login_info`、`get_cookies`（Qzone 理论侧门【未验证】）
- 事件：消息/通知（戳一戳、成员变动）/请求（加好友/加群）/元事件（心跳）

## 3. 部署与桥接

- **独立进程**：NapCat 与 DSH 两个 OS 进程。插件 reload/dispose 不动 QQ 登录态；扫码运维在插件之外；多鲸鱼 = 多 NapCat 实例 + 多条 WS。
- **正向 WS 连接**（`ws://127.0.0.1:3001` + token）；HTTP 模式留作调试后门。
- **重连纪律**：指数退避 1s→60s 封顶 + 抖动；重连成功先 `get_login_info` 区分"连接断"与"账号掉"；不做激进进程守护（社区踩坑：反复掉线多是守护脚本自伤）。
- 已知痛点：被踢线后二维码/快捷登录可能卡死（[NapCat#1962](https://github.com/NapNeko/NapCatQQ/issues/1962)）——把"请主人重扫"当正常运维流程设计。

## 4. 插件集成设计（src/platforms/qq/）

```
src/platforms/qq/
├── index.js          # registerQQ(ctx, whale)：装配各模块，随 ctx.dispose 断开
├── credentials.js    # 读 accounts[].credentials → data/secrets/qq-<id>.json
├── connection.js     # WS 客户端：token 鉴权、心跳监测、指数退避重连
├── api.js            # callApi(action, params)：echo 配对、超时、retcode!=0 抛错
├── events.js         # OneBot 事件 → 鲸生标准事件（message/notice/request 归一）
├── session.js        # 会话映射 {kind:'dm'|'group', peerId}；dmPolicy/friendPolicy 落地点
└── risk.js           # 风控状态机：online / degraded / stranded（搁浅）
```

凭据文件格式（`data/secrets/`）：

```json
{ "impl": "napcat", "transport": "ws", "endpoint": "ws://127.0.0.1:3001", "token": "<随机长串>", "selfId": 10001 }
```

**审批收口**：所有出站动作经 `act(action, params, riskClass)` 单一收口——dry-run 拦截全部 mutating 调用只写日志；semi 档高危请示（主动私聊非好友、好友请求处理【注意有效期，请示带超时】、群管理、批量发送）；auto 直通但受 `limits` 与 ≥3s 限速约束。

**风控状态机**：心跳缺失→degraded 重连；重连后 `get_login_info` 失败→stranded（搁浅：暂停出站、通知主人重扫）；短时失败率超阈值→自动降级 dry-run。状态映射到她的状态图（搁浅=睡觉素材）+ `runtime.report.events`。

## 5. 风险与缓解

| 最坏情况 | 影响 | 缓解 |
|---|---|---|
| 封号/冻结 | 社交图谱蒸发（记忆/日志可留存） | 牺牲号策略、行为纪律、每日备份 `data/`（转生时记忆延续） |
| 协议失效（QQ 大版本） | 她"昏睡"数天到数周（常态化间歇风险） | 沉睡叙事态 + 一次性通知，不刷屏报错 |
| NapCat 停维护 | 协议端需更换 | OneBot 11 抽象层，LLBot/Lagrange 即插即换 |

**起步建议**：`approvalMode: semi` + dry-run 观察两周再放开；QQ 空间用轻动态顶上，Qzone 旁路默认关闭。

## 附：主要来源

NapCat [仓库](https://github.com/NapNeko/NapCatQQ)/[文档](https://napneko.github.io/)/[安全](https://napneko.github.io/other/security)/[扩展接口](https://napneko.github.io/develop/api/doc) · [OneBot 11 标准](https://github.com/botuniverse/onebot-11/blob/master/api/public.md) · [海豹骰 QQ 部署](https://docs.sealdice.com/deploy/platform-qq.html) · [LangBot 对接 NapCat](https://v3.docs.langbot.app/deploy/platforms/qq/aiocqhttp/napcat) · [linux.do 风险讨论](https://linux.do/t/topic/515776) · [qqgroupbot 安全建议](http://www.qqgroupbot.com/48.html) · [aioqzone](https://github.com/aioqzone) · [掘金掉线排查](https://juejin.cn/post/7693049513120186414)
