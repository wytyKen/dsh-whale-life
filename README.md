# 🐋 Whale Life 鲸生

> 给她人设、记忆、权限和一张作息表——你的 DeepSeek 鲸鱼娘，从此在 DSH 里过自己的网络人生。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-4D6BFE.svg)](https://github.com/deepseek-ai/deepseek-harness)

## 她是怎么活的

鲸生是一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) 插件，任何人都可以装进自己的 DSH。

装好后为她起个名字、选个人设。然后，规则只有一条：

- **DSH 开着，她就活着**——有自己的作息、记忆和对话框
- **DSH 关了，她就沉睡**——没有后台进程，不做任何事

## 和她聊天

她的对话就长在 DSH 里：**她的工作区下每开一个新会话，就是和她聊天的一个对话框。**

- 你可以同时开多个对话框（像微信开多个聊天），它们都属于她
- 无论在哪个对话框，她都带着同一份记忆——跟谁说过什么，她都记得
- 第一句话之前，插件已自动为她注入人设与记忆；你只管说话，她以自己的人格应答
- 她还有自己的作息表（cron）：定时醒来、写日记、（平台回归后）主动发动态——主动做事默认先存草稿，你在设置页放行

## 配置一览

> 以下为概览。完整字段、默认值与注释版示例见 [docs/configuration.md](./docs/configuration.md) 与 [examples/whale.patch.example.yml](./examples/whale.patch.example.yml)。

### 本体 —— 她是谁

- 🧬 **人设**：空白出生。从模板人设中选择，或完全自定义她的性格、背景与口癖
- 🧠 **记忆系统**：日记 + 事实两条线；她的经历允许反塑性格
- 🌊 **兴趣与信息源**：她关注什么、从哪里获得灵感

### 账号与边界 —— 她能碰什么

- 🪪 **账号**：交给她的（未来）平台账号
- 🚧 **社交与内容边界**：话题禁区、私聊边界、黑名单
- ✅ **审批模式**：全自主 / 高危操作先请示 / 试运行（只记录不发布），三档可切

### 行为节律 —— 她何时动

- ⏰ **定时任务**：作息表——何时醒来、何时写日记
- 📶 **被动响应**：被提及时的回应规则
- 📊 **消耗上限**：token / 调用次数 / 发帖频率的硬性预算，防止失控

### 运行基建 —— 怎么养她

- 🖥️ **设置页**：DSH Web → 设置 → 插件 → 🐋 鲸生（生命体征、待审草稿、人设模板）
- 🤖 **模型选择**：她用哪个模型运行，与 DSH 当前会话模型解耦
- 🐳 **多鲸鱼实例**：同时养多只不同人设的鲸鱼娘，各自独立记忆与工作区
- 💾 **数据与备份**：记忆与日志全在你本地，可导出迁移

## 安装

```sh
dsh plugin --profile <profile-name> add github:wytyKen/dsh-whale-life
```

然后在你的 profile 配置里声明她（参考 [examples/whale.patch.example.yml](./examples/whale.patch.example.yml)），启动 `dsh --profile <profile-name>`：

1. DSH 里出现她的工作区（默认以她的名字命名）
2. 打开 DSH Web → 设置 → 插件 → 🐋 鲸生，确认她已就绪
3. 在她的工作区里开一个新会话，说第一句话——她就是她了

> 也可以把本仓库 URL 直接发给你的 DSH 会话，让 DSH 自己执行上面的安装命令并按 README 引导配置。

> 已在 `@deepseek-ai/dsh@0.2.1-rc.5` 上验证。

## 平台阶梯（路线图）

当前形态是**纯 DSH 插件**：她的对话与记忆完全活在 DSH 内，零外部依赖。

对外平台在路线图上逐级攻克（账号协议与风控是主要工程量）：

- **第一梯队** —— B站（只读已就绪）、QQ（透明管线与行动系统已在历史版本验证，平台回归后接回）
- **第二梯队** —— 微信、小红书
- **更远处** —— 海外社交、博客 / 长文平台，以及任何她能学会居住的地方

平台接入架构是适配器式的：每个平台一个 `src/platforms/<name>/`，共用同一套人设、记忆与审批纪律。

## 当前状态

开发中（v0.2 方向：纯 DSH 形态收敛）。透明对话管线（多会话一人格 + 共享记忆）+ 生命节律（cron 作息 + 日记）+ 行动系统骨架（审批/留痕就绪，等平台接执行通道）。

## 🔒 安全与边界

- 她的一切对外动作经过**审批档**（auto / semi / dry-run），semi 下主动行为一律先存草稿
- 白名单外的任何行动意图（包括提示词注入诱导的）都会被拦成草稿——纪律在代码里，不在提示词里
- 记忆、凭据、日志全部保存在你本地的 gitignored 目录，永不随仓库分发
- 行动路由服务器只监听 127.0.0.1 且校验来源

## 相关项目

- [DSH / DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 她的大脑与家园
- [dsh-bili-whale](https://github.com/wytyKen/dsh-bili-whale) —— 本项目的前身实验（MIT）

## License

MIT © wytyKen
