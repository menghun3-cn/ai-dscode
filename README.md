# DSCODE

> 对接 DeepSeek 优先、兼容多模型的命令行 AI 编码助手（AI IDE CLI）。
> DeepSeek-first, multi-provider AI coding assistant for the terminal.

**当前状态：MVP（v0.1）已完成并通过验收（SC-1.1~1.10 全 PASS）。** 代码为 pnpm monorepo 三包（`@dscode/core` / `@dscode/ai` / `@dscode/cli`），配套 `docs/` 全量设计文档。

## 定位

| 维度 | 取舍 |
|------|------|
| 形态 | 终端 CLI（非 GUI IDE），对标 Claude Code / Codex CLI |
| 首要模型 | DeepSeek（V3.x / R1，含 reasoning 模型） |
| 兼容模型 | OpenAI、Anthropic、本地推理（OpenAI 兼容协议）、OpenRouter |
| 目标用户 | 国内 DeepSeek 开发者、私有化/可控成本团队、CI/headless 场景 |
| 差异化 | DeepSeek 一等公民 + 中文场景打磨 + 开源可扩展 |

## 文档入口

所有文档从 [docs/索引文档.md](docs/索引文档.md) 导航：

- 架构：[架构文档.md](docs/架构文档.md) · 需求：[需求文档.md](docs/需求文档.md) · 验收：[成功标准.md](docs/成功标准.md)
- 原理类（12 份）：Agent Loop / 上下文压缩 / 计划执行 / 文件工具 / 沙盒执行 / MCP / Web 检索 / Session / Provider / 权限 / 扩展 / TUI
- 进度：[todos-list.md](docs/todos-list.md)（当前 → 已完成项 [todos-done.md](docs/todos-done.md)）

## MVP 范围（v0.1，Milestone 1）

单 provider（DeepSeek）+ 四工具（read/write/edit/bash + glob/grep）+ Agent Loop + print/interactive 两模式，验收标准为 [SC-1.1 ~ SC-1.10](docs/成功标准.md)。详见 [todos-list.md](docs/todos-list.md)。

## 技术栈

TypeScript + Node 22 + pnpm workspace（三包）+ vitest；Bun 编译单二进制分发（v1.0）。

## 开发

```bash
pnpm install
pnpm -r build        # 三包构建零错误
pnpm test            # vitest 全量测试（22 文件 100 用例）
pnpm verify          # M1 验收：跑 SC-1.1~1.10，输出 PASS/FAIL 表
```

## M1 验收实测（2026-08-07）

MVP 已用真实 DeepSeek 兼容网关跑通全部 10 条成功标准：

| SC | 内容 | 结果 |
|----|------|------|
| SC-1.1 | 启动与鉴权（auth.json 0600） | PASS |
| SC-1.2 | 环境变量鉴权 | PASS |
| SC-1.3~1.6 | read / write / edit / bash 四工具 | PASS |
| SC-1.7 | Agent Loop 多轮（跑测试→修复→通过，5 轮工具调用） | PASS |
| SC-1.8 | print 模式 stdin 管道 | PASS |
| SC-1.9 | interactive 最小可用 | PASS |
| SC-1.10 | 中文回退 | PASS |

验收脚本 `scripts/verify-m1.mjs` 输出 PASS/FAIL/SKIP 表，LLM 相关 SC 失败时 dump turn 轨迹（每轮 tool_call + 结果 + 收敛原因）。网关/模型可通过环境变量覆盖：

```bash
DSCODE_BASE_URL=http://127.0.0.1:8000/v1 \
DSCODE_API_KEY=sk-... \
DSCODE_MODEL=deepseek-v4-flash \
pnpm verify          # 默认模型 deepseek-v4-flash；可分段跑（DSCCODE_VERIFY_ONLY=SC-1.7）
```

> 首次运行无 key 时 interactive 模式会引导输入并保存到 auth.json（0600）。

## 安全

- API key 仅存 `~/.dscode/auth.json`（0600），支持环境变量鉴权。
- 权限模型：allow/deny/ask 规则 + 四级审批模式（read-only/ask/auto-edit/full-auto）。
- 危险命令（`rm -rf`、`sudo`、`git push --force`）二次确认。

## License

待定（倾向 Apache-2.0）。设计借鉴 pi、Claude Code 等，落地时在代码与文档中注明出处。
