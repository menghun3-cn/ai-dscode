# DSCODE

> 对接 DeepSeek 优先、兼容多模型的命令行 AI 编码助手（AI IDE CLI）。
> DeepSeek-first, multi-provider AI coding assistant for the terminal.

**当前状态：v0.7（M1~M7 全部关闭：MVP / Session / 多 Provider / 扩展系统 / 权限与 Plan / Compaction / MCP 与 RPC；SC-6.1/6.2/6.3 实测通过）。** 代码为 pnpm monorepo 三包（`@dscode/core` / `@dscode/ai` / `@dscode/cli`），配套 `docs/` 全量设计文档。

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

## 安装

**方式一：npm 全局安装（SC-6.1，发布后可用）**

```bash
npm i -g dscode
dscode --version   # 输出版本号即安装成功
```

**方式二：单二进制（推荐，免 Node 环境）**

从 [GitHub Releases](https://github.com/menghun3-cn/ai-dscode/releases) 下载对应平台二进制（`dscode-linux-x64` / `dscode-macos` / `dscode-windows-x64.exe`），放入 PATH 即可：

```bash
# Windows
dscode.exe --version
# Linux / macOS
./dscode --version
```

也可本地自行编译（需 Bun）：

```bash
pnpm install
pnpm build:binary   # 产出 dist/dscode.exe（Windows）或 dist/dscode（Linux/macOS）
```

**方式三：源码运行（Node 22+）**

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js   # 或 pnpm exec --filter @dscode/cli …
```

## 使用

首次运行前配置 API key（三选一，优先级 `--api-key` > `auth.json` > 环境变量）：

```bash
export DSCODE_API_KEY=sk-...              # 环境变量（推荐 CI）
dscode                                     # 交互模式首次引导输入并保存 auth.json（0600）
dscode --api-key sk-...                    # 启动参数覆盖
```

常用命令：

```bash
dscode                              # 交互模式（TUI）：/exit /help /model /cost /clear
dscode -p "重构 auth 模块"           # print 模式：一次性执行
echo "总结这句话" | dscode -p -      # stdin 管道
dscode -p "跑 npm test，失败就修复到通过"   # Agent Loop 多轮自动修复
dscode -p "..." --mode json         # 结构化事件流（CI，v0.4 完善）
dscode --model deepseek-reasoner -p "..."   # 指定模型
```

环境变量（`dscode --help` 可查全部）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSCODE_API_KEY` | 空 | API key（兼容 `DEEPSEEK_API_KEY`/`DSAPI_API_KEY`） |
| `DSCODE_MODEL` | `deepseek-v4-flash` | 默认模型 |
| `DSCODE_BASE_URL` | `https://api.deepseek.com` | 网关地址（兼容 `DSAPI_BASE_URL`）。**OpenAI 风格网关/代理需以 `/v1` 结尾**（如 `http://127.0.0.1:8000/v1`），官方 DeepSeek API 不需要（默认值即可）。配错会 404 |
| `DSCODE_HOME` | `~/.dscode` | 数据目录 |
| `DSCODE_DEBUG=1` | — | DEBUG 日志 |

## MVP 范围（v0.1，Milestone 1）

单 provider（DeepSeek）+ 四工具（read/write/edit/bash + glob/grep）+ Agent Loop + print/interactive 两模式，验收标准为 [SC-1.1 ~ SC-1.10](docs/成功标准.md)。详见 [todos-list.md](docs/todos-list.md)。

## 技术栈

TypeScript + Node 22 + pnpm workspace（三包）+ vitest；Bun 编译单二进制分发。

## 开发

```bash
pnpm install
pnpm -r build        # 三包构建零错误
pnpm test            # vitest 全量测试（22 文件 101 用例）
pnpm verify          # M1 验收：跑 SC-1.1~1.10，输出 PASS/FAIL 表
```

## 单二进制分发

```bash
pnpm build:binary    # 先构建三包，再 bun build --compile → dist/dscode(.exe)
```

- 产物为单文件，免 Node 环境（SC-6.2 验收：无 Node 机器上 `./dscode --version` 成功）。
- 默认编译当前平台；跨平台产物用 `--target` 指定（在对应平台或 CI 矩阵里编译）：

```bash
bun build --compile packages/cli/src/index.ts --outfile dist/dscode \
  --target=bun-linux-x64        # Linux x64
  # --target=bun-windows-x64    # Windows x64
  # --target=bun-darwin-arm64   # macOS Apple Silicon
```

- `dist/` 已被 .gitignore 忽略，二进制不入库，随 Release 分发。

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
pnpm verify          # 默认模型 deepseek-v4-flash；可分段跑（DSCODE_VERIFY_ONLY=SC-1.7）
```

> 首次运行无 key 时 interactive 模式会引导输入并保存到 auth.json（0600）。

## 安全

- API key 仅存 `~/.dscode/auth.json`（0600），支持环境变量鉴权。
- 权限模型：allow/deny/ask 规则 + 四级审批模式（read-only/ask/auto-edit/full-auto）。
- 危险命令（`rm -rf`、`sudo`、`git push --force`）二次确认。

## License

待定（倾向 Apache-2.0）。设计借鉴 pi、Claude Code 等，落地时在代码与文档中注明出处。
