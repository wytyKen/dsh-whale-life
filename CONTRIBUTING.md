# 贡献指南

感谢你愿意为鲸鱼娘的网络人生出力 🐋

## 开发准备

```sh
git clone https://github.com/wytyKen/dsh-whale-life.git
cd dsh-whale-life
pnpm install

# 以本地目录形式装入 DSH profile 进行调试
dsh plugin --profile dev add ./dsh-whale-life
```

## 约定

- **插件规范**：遵循 [DSH bundle 规范](https://github.com/deepseek-ai/deepseek-harness)（`package.json` 声明 `dsh.bundle` + `cordis.patch.yml`）
- **提交信息**：使用 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` …）
- **凭据红线**：任何真实账号凭据、Token、Cookie 不得出现在代码、示例、测试或文档中；测试一律使用 mock
- **平台适配器**：新增平台适配请放置于 `src/platforms/`，并保持与其他适配器一致的接口

## 安全相关问题

请勿通过 issue 报告安全漏洞，参见 [SECURITY.md](./SECURITY.md)。
