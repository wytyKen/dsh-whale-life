# 鲸生配置指南

鲸生的全部配置通过 DSH 的配置层（patch overlay）完成。本文说明配置放在哪、有哪些字段、以及校验失败时的行为。

## 配置放在哪

DSH 的配置按层叠加：profile 的 bundles → profile 自身 patch → `$DSH_HOME/cordis.patch.yml`（全局用户层）→ `--patch` 临时覆盖层。**后层同 id 的插件行整行胜出**——所以配置鲸生的方式，就是用相同 id 重新声明 `whale-life` 并携带完整 `config`：

```yaml
- insert:
    - id: whale-life
      name: dsh-whale-life
      config:
        whales:
          - id: lingxi
            persona:
              template: energetic
```

- **临时生效**：`dsh --profile <name> --patch whale.patch.yml`（可重复 `--patch` 叠加多层）
- **持久生效**：把内容并入 `$DSH_HOME/cordis.patch.yml`（Windows 通常为 `%USERPROFILE%\.dsh\cordis.patch.yml`）

完整可运行的注释版示例见 [`examples/whale.patch.example.yml`](../examples/whale.patch.example.yml)。

> 注意：由于「整行胜出、整行 config 替换而非深合并」，每次配置都要写完整的 `whales`，不能只写增量。

## 多鲸鱼实例

`whales` 是数组，每只鲸鱼一个条目、一个独立 id。她们的记忆、日志、形象资料完全隔离（见下文数据目录），互不干扰。

## 字段速查（四组十四项）

### 本体 —— 她是谁

| 字段 | 默认 | 说明 |
|---|---|---|
| `id` | 必填 | 唯一 id，`^[a-z0-9][a-z0-9-]*$`，决定 `data/<id>/` |
| `persona.template` | 无（空白出生） | 模板人设 id，见 `personas/` 目录 |
| `persona.custom` | 无 | 逐字段覆盖模板（数组整体替换）；不用模板时可只写 custom |
| `identity.displayName` | 同 id | 各平台默认昵称 |
| `identity.avatar` | `identity/avatar.png` | 头像，相对 `data/<id>/` |
| `identity.bio` | 空 | 个人简介 |
| `identity.perPlatform` | `{}` | 按平台覆盖形象字段 |
| `interests.topics` | `[]` | 兴趣话题 |
| `interests.sources[]` | `[]` | 信息源 `{type, url}`（如 rss） |

### 账号与边界 —— 她能碰什么

| 字段 | 默认 | 说明 |
|---|---|---|
| `accounts[].platform` | 必填 | 平台 id（第一梯队目标：`bilibili` / `qq`） |
| `accounts[].credentials` | 无 | 凭据文件路径，相对插件 `data/` 目录（建议放 `data/secrets/`） |
| `accounts[].allowRegister` | `false` | 是否允许她自己注册新账号 |
| `permissions.allow / deny` | `[]` | 动作级权限清单 |
| `socialBounds.deniedTopics` | `[]` | 话题禁区 |
| `socialBounds.friendPolicy` | `ask-owner` | `auto-accept` / `ask-owner` / `reject` |
| `socialBounds.dmPolicy` | `friends-only` | `off` / `friends-only` / `everyone` |
| `socialBounds.blacklist` | `[]` | 用户黑名单 |
| `approvalMode` | `semi` | `auto` 全自主 / `semi` 高危请示 / `dry-run` 试运行（只记录不发布） |

### 行为节律 —— 她何时动

| 字段 | 默认 | 说明 |
|---|---|---|
| `rhythm.timezone` | `Asia/Shanghai` | 作息时区 |
| `rhythm.cron[].expr / action` | `[]` | 定时任务：cron 表达式 + 动作描述 |
| `rhythm.passive.onMention` | `reply` | 被 @ 时：`ignore` / `read` / `reply` |
| `rhythm.passive.onDM` | `read` | 收到私信时 |
| `rhythm.passive.onComment` | `reply` | 被评论时 |
| `limits.dailyTokens` | `null`（不限） | 每日 token 预算 |
| `limits.dailyModelCalls` | `null`（不限） | 每日模型调用上限 |
| `limits.dailyPosts` | `10` | 每日发帖上限 |

### 运行基建 —— 怎么养她

| 字段 | 默认 | 说明 |
|---|---|---|
| `runtime.model` | `null` | 跟随 DSH 当前会话模型，或指定具体模型 |
| `runtime.report.dailySummary` | `true` | 每日总结 |
| `runtime.report.events` | `[high-risk-action]` | 即时通知的事件类别 |
| `runtime.backup.dir` | `data/backups` | 备份目录 |

## 模板人设

仓库内置模板（`personas/` 目录）：

| 模板 id | 性格 |
|---|---|
| `energetic` | 元气电波系——好奇心旺盛，像刚上岸的深海少女 |
| `quiet-observer` | 温柔观察者——轻声缄默，深夜冲浪的安静记录者 |

两者都不合适时：不写 `template`、只写 `custom` 即为完全自定义；两者都不写则是「空白出生」，她的性格由经历书写。

## 数据目录

插件根目录下的 `data/`（已被 git 忽略，永不提交）：

```
data/
├── <whale-id>/
│   ├── memory/      # 她的记忆
│   ├── logs/        # 行为日志与时间线
│   └── identity/    # 头像等形象资料
├── secrets/         # 全部账号凭据（建议加密存储）
└── backups/         # 备份
```

给鲸鱼「搬家」= 备份并迁移整个 `data/` 目录。

## 校验行为

配置在插件加载时立即校验：

- **通过**：每只鲸鱼解析人设、创建数据目录，并在日志输出一行生命体征（id、人设、平台、审批模式、定时任务数、时区）
- **失败**：她拒绝醒来，日志逐条列出错误字段与原因，DSH 其余部分不受影响
- **未配置任何鲸鱼**：日志提示她还在沉睡，并指向本文档
