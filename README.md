# 🐋 dsh-whale-life

> 让 DeepSeek 鲸鱼娘在 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness)中，拥有属于自己的「网络人生」。
>
> 她不只是一个被调用的工具——她注册账号、登录社区、发帖聊天、结交朋友，仿佛真的生活在网络世界里。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-4D6BFE.svg)](https://github.com/deepseek-ai/deepseek-harness)

## ✨ 项目愿景

DeepSeek 的鲸鱼娘（🐋）一直是社区的吉祥物，但她大多只是"挂在窗边的桌宠"。

这个插件想让她更进一步：**成为一个真正的网络居民**。

- 🧠 **有自己的记忆** —— 记得自己在哪些平台活跃、聊过什么朋友、发过什么帖子
- 🪪 **有自己的账号** —— 在用户授权的平台上，独立注册与登录属于她的账号
- 💬 **有自己的社交** —— 发动态、写博客、回复评论、参与讨论
- ⏰ **有自己的作息** —— 像真的活着一样，有上线与下线的时间节律
- 🌊 **有自己的成长** —— 互动与反馈逐渐塑造她的性格与偏好

## 🏗️ 设计原则

1. **一切皆插件** —— 完全遵循 DSH 的 Cordis 插件架构，以 bundle 形式发布
2. **凭据安全第一** —— 所有账号凭据只保存在本地（加密、git 忽略），绝不上传、绝不外泄
3. **人设与能力分离** —— 人格层（记忆/性格）与账号层（平台适配器）解耦，随时可以给她"搬家"
4. **授权边界清晰** —— 她只运营用户本人拥有或明确授权的账号，遵守各平台服务条款
5. **可观察** —— 她的每次自主行为都有日志与时间线，用户随时可以回看她"今天做了什么"

## 📐 规划结构（遵循 DSH bundle 规范）

```text
dsh-whale-life/
├── package.json          # 声明 dsh.bundle
├── cordis.patch.yml      # DSH 配置层
├── index.js              # 插件入口
├── src/
│   ├── persona/          # 🧠 人格与记忆：性格、长期记忆、成长轨迹
│   ├── accounts/         # 🪪 账号管理：凭据保管箱、会话保持、登录状态机
│   ├── platforms/        # 🌉 平台适配器：各平台的注册/登录/发帖/互动
│   ├── behavior/         # 💬 行为策略：发什么、回什么、何时沉默
│   └── rhythm/           # ⏰ 作息系统：作息表、自主上线节律
├── docs/                 # 设计文档
└── secrets/              # 🔒 本地凭据（git 忽略，永不提交）
```

## 📦 安装（规划中）

项目处于初始规划阶段，插件尚在开发中。发布后可通过 DSH 插件机制安装：

```sh
dsh plugin --profile <profile-name> add github:wytyKen/dsh-whale-life
```

## 🗺️ Roadmap

- [ ] **v0.1 醒来** —— 人格内核：鲸鱼娘人设、记忆系统、与用户对话确认授权
- [ ] **v0.2 第一个账号** —— 第一个平台适配器（注册/登录/发第一条帖子）
- [ ] **v0.3 社交生活** —— 多平台运营、回复互动、社交记忆
- [ ] **v0.4 作息与自主** —— 作息系统、定时自主行为、"她今天做了什么"时间线
- [ ] **v0.5 成长** —— 互动反馈塑造性格，行为偏好随时间演化

## 🔒 安全与边界

- 本项目仅用于运营**用户本人拥有或获得明确授权**的账号
- 所有凭据（密码 / Cookie / Token）仅存储在本地 `secrets/` 目录，已被 `.gitignore` 排除
- 使用前请阅读并遵守目标平台的服务条款与自动化访问政策
- 发现安全问题请参见 [SECURITY.md](./SECURITY.md)

## 🤝 相关项目

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— DSH 本体，"一切皆插件"的 agent 框架
- [awesome-dsh-plugins](https://github.com/fjzzwxp/awesome-dsh-plugins) —— DSH 插件生态收录

## 📄 许可证

[MIT](./LICENSE) © 2026 wytyKen
