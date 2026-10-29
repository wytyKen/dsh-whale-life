# 贡献指南

感谢你愿意为鲸鱼娘的网络人生出力 🐋

## 开发环境（自包含隔离）

本仓库自带完全隔离的 dsh 运行时与数据家，**不依赖、也不污染机器上任何其他 dsh 环境**：

- `runtime/` —— 本仓库专属的 dsh 程序副本（锁定 `@deepseek-ai/dsh@0.2.1-rc.5`，含 pnpm-lock）
- `dsh-home/` —— 本仓库专属的 DSH 数据家（profiles / sessions / 凭据等，git 忽略）
- `dsh.cmd` / `dsh.sh` —— 唯一入口：自动设置 `DSH_HOME` 指向仓库内数据家后调用 runtime 副本

```sh
git clone https://github.com/wytyKen/dsh-whale-life.git
cd dsh-whale-life
pnpm install                  # 插件自身依赖
pnpm --dir runtime install    # 隔离的 dsh 运行时副本

# 之后一切 dsh 操作都走仓库包装脚本：
./dsh.sh plugin --profile whale add .                        # 装入测试 profile（Windows 用 dsh.cmd）
./dsh.sh --profile whale --dump-config                       # 检查配置层合成
./dsh.sh --profile whale --patch examples/whale.patch.example.yml   # 携带示例配置启动
npm test                                                      # 单元测试
```

> 红线：不要对本仓库使用全局 `dsh` 或 `npx @deepseek-ai/dsh`——那会把数据写进默认家目录 `~/.dsh`，与机器上其他环境纠缠。

## 约定

- **插件规范**：遵循 [DSH bundle 规范](https://github.com/deepseek-ai/deepseek-harness)（`package.json` 声明 `dsh.bundle` + `cordis.patch.yml`）
- **提交信息**：使用 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` …）
- **凭据红线**：任何真实账号凭据、Token、Cookie 不得出现在代码、示例、测试或文档中；测试一律使用 mock
- **平台适配器**：新增平台适配请放置于 `src/platforms/`，并保持与其他适配器一致的接口
- **版本升级**：`runtime/` 的 dsh 版本变更是主动动作——升级后需重跑全套验证（install → dump-config → 配置挂载）

## 安全相关问题

请勿通过 issue 报告安全漏洞，参见 [SECURITY.md](./SECURITY.md)。
