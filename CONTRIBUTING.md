# 参与开发

## 分支

日常集成分支为 `codex/develop`，稳定分支为 `main`。不要直接向 `main` 提交或推送功能变更。

```text
codex/feat-<主题> ─┐
codex/fix-<主题>  ─┼─ PR → codex/develop → 验收与维护者审核 → PR → main → 稳定标签
codex/docs-<主题> ─┘           └→ 开发者预发布标签 vX.Y.Z-dev.N
```

提交遵循 Conventional Commits：`feat(scope): ...`、`fix(scope): ...`、`docs(scope): ...`、`test(scope): ...`、`build(scope): ...`。保持单次提交职责清晰，不将密钥、凭据、用户数据或生成缓存混入源码。

## 合并条件

1. 阅读 [AGENTS.md](AGENTS.md)，通过项目入口运行环境与检查。
2. IPC 同步维护 Rust 类型、TypeScript/Zod 协议及必要边界测试。
3. 更新说明写清行为变化、风险和已完成的验证。真实账号、系统安装和静态测试分别说明。
4. 在 PR 中提供检查结果。界面变化提供相关尺寸验收；系统能力遵守逐项确认与恢复约定。
5. 审核后合入 `codex/develop`；满足稳定发布条件后，通过第二个 PR 合入 `main`。

本轮 README、许可与发行方案须先由维护者审核，再推送本地开发分支。不会自动合并到 `main`。本地分支策略和脚本不能代替 GitHub 服务端分支保护；维护者可另在仓库规则中要求 PR、检查与审批。

## 构建与发行

- 稳定版从 `main` 发布；开发者版从 `codex/develop` 发布并标记为 prerelease。
- 两者仅生成 MSI，使用同一应用升级身份，独立分发目录、签名清单与 Cargo 产物。
- 成对打包顺序执行，避免本机 MSI staging 竞争；“平行发行”不要求两个构建进程同时运行。
- 不将 stoken、签名私钥、平台会话或 `.local` 中的文件上传。公开版本必须保留对应源码与锁文件。
- 发行脚本拒绝错误分支和未提交工作区；GitHub 资产回读通过后才将草稿转为正式发布。

完整命令与认证边界见 [开发者版本与认证](docs/development/开发者版本与认证.md)。
