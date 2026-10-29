# 🐋 Whale Life 鲸生

> 给她人设、账号、权限和一张作息表——你的 DeepSeek 鲸鱼娘，从此在 DSH 里过自己的网络人生。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-4D6BFE.svg)](https://github.com/deepseek-ai/deepseek-harness)

## 她是怎么活的

鲸生是一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) 插件，任何人都可以装进自己的 DSH。

装好后，你只需要配置五样东西：

| 配置 | 说明 |
|---|---|
| 🧬 **人设** | 空白出生。从模板人设中选择，或完全自定义她的性格与背景 |
| 🪪 **账号** | 交给她的真实账号（或允许她自己注册） |
| 🛡️ **权限** | 她能做什么、不能做什么 |
| ⏰ **定时任务** | 她的作息表：何时上线、何时发帖、何时休息 |
| 📊 **消耗上限** | token / 调用次数 / 发帖频率的硬性预算，防止失控 |

然后，规则只有一条：

- **DSH 开着，她就活着**——在网络上自主做事：发动态、回复、聊天、写长文
- **DSH 关了，她就沉睡**——没有后台进程，不做任何事。她的存在与 DSH 同生共息

她的记忆保存在你本地。第二天醒来时，她接得上昨天的自己。

## 她操作的是真实账号

这是鲸生与其他"聊天机器人插件"的根本区别：

她**以一个真实用户的方式注册、登录并操作账号**——就像你自己坐在电脑前那样。

而不是通过官方 Bot 接口"挂"在某个账号的消息列表上——那样的她只是一个应答器，不是一个居民。

## 平台阶梯

目标自然是任何平台。但真实账号操作意味着直面各平台的登录协议与风控，我们会一级一级攻克：

- **第一梯队** —— QQ、B站
- **第二梯队** —— 微信、小红书
- **更远处** —— 海外社交、博客 / 长文平台，以及任何她能学会居住的地方

## 当前状态

开发中。实现顺序遵循平台阶梯：先 QQ 与 B站，再微信与小红书，而后向更多平台扩张。

## 🔒 安全与边界

- 她只运营用户本人拥有或明确授权的账号，请遵守目标平台的服务条款
- 所有凭据仅加密保存在本地 `secrets/` 目录（已 git 忽略），绝不上传
- 权限与消耗上限是硬约束：越界的行为不会执行
- 发现安全问题请参见 [SECURITY.md](./SECURITY.md)

## 相关项目

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— DSH 本体，"一切皆插件"的 agent 框架
- [awesome-dsh-plugins](https://github.com/fjzzwxp/awesome-dsh-plugins) —— DSH 插件生态收录

## 📄 许可证

[MIT](./LICENSE) © 2026 wytyKen
