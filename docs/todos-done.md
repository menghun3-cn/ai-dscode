# DSCODE Todos Done

> 已完成项归档。每条含：ID、完成时间、证据摘要、对应 SC。
> 新条目从 todos-list.md 达成后迁入。

---

## 基线：架构调研与文档立项

### D-0.1 竞品架构调研
- **完成时间**：2025-08-07
- **内容**：穷尽调研 Claude Code / Cursor / Cursor CLI / Codex CLI / Grok Code / OpenCode / pi / Kiro 七款主流 AI IDE CLI 的公开架构与设计原理。
- **关键产出**：
  - Claude Code：JSONL session / Agent Loop / MCP / Hooks / Permission / Plan / Sub-agent / CLAUDE.md
  - Codex CLI：Rust 单二进制 / OpenAI Responses / ratatui / seatbelt-landlock 沙箱 / read-only-auto-edit-full-auto 三级审批
  - Cursor CLI：headless 优先 / Codex-compatible 协议
  - OpenCode：TS+Bun / 开源 / LSP diagnostics 注入
  - pi：monorepo 三包（agent-core/ai/tui）/ 三种模式 / 树状 session / 40+ provider 含 DeepSeek 原生 / 事件驱动 extension / AGENTS.md / compaction —— **本地源码级深读**
  - Kiro：spec-first / steering files
- **证据**：架构文档.md §2；本地 pi 源码（`~/.pi/.../@earendil-works/pi-coding-agent/dist`、`docs/`）已读。
- **对应**：无（前置调研）

### D-0.2 技术路线选型
- **完成时间**：2025-08-07
- **决策**：
  - 语言 TypeScript + 运行时 Node 22（主）/ Bun（可选编译单二进制）
  - 构建 pnpm workspace monorepo，三包 `@dscode/core` / `@dscode/ai` / `@dscode/cli`
  - 协议 OpenAI 兼容为主，Anthropic Messages 为辅，DeepSeek 一等公民
  - Session JSONL 树状，事件驱动 extension，DSCODE.md + .dscode 约定
- **理由**：详见架构文档.md §3。平衡"开发速度 / 生态 / DeepSeek 兼容 / 分发"。
- **对应**：无（技术选型）

### D-0.3 五份立项文档落地
- **完成时间**：2025-08-07
- **产物**：
  - `docs/架构文档.md` — 顶层架构、三包切分、Agent Loop、session、provider、工具、权限、extension、compaction、里程碑
  - `docs/需求文档.md` — 14 FR、用户故事、MoSCoW 优先级
  - `docs/成功标准.md` — 6 milestone 共 30+ 可验证 SC + 4 NFR
  - `docs/todos-list.md` — 9 milestone 细化 todo，每条带 P/SC 验收，含依赖图
  - `docs/todos-done.md`（本文件）
- **证据**：`ls -la docs/` + 各文件字节数非零。
- **对应**：无（立项基线）

---

## Milestone 1：MVP 闭环（v0.1）✅ 2026-08-07 验收通过

> 全部完成项从 todos-list.md 迁入。验收：`scripts/verify-m1.mjs` 跑 SC-1.1~1.10 全 PASS（真实 DeepSeek 兼容网关，`DSCODE_BASE_URL` + `DSCODE_API_KEY` + `DSCODE_MODEL`）。
> 后置 P1 打磨项（`@`/`!` 命令、中文宽度/IME）留在 todos-list.md，不阻塞 M1 关闭（SC-1.9 边界）。

### M1-S1 项目骨架
- **完成时间**：2026-08-07
- **内容**：pnpm workspace monorepo 三包（`@dscode/core` / `@dscode/ai` / `@dscode/cli`）；CLI 入口与 args 解析（`-p/--print`、`--mode`、`--provider`、`--model`、`--api-key`、`-c/-r`、`-h`）；模式分发器（interactive/print/json/rpc，json/rpc 占位）。
- **证据**：`pnpm i` 成功；`pnpm -r build` 三包零错误；`--help` 列全参数；resolveMode 四分支单测通过。
- **对应**：FR-1/FR-2、SC-1.1

### M1-S2 Provider 层（`@dscode/ai`）
- **完成时间**：2026-08-07
- **内容**：`Provider`/`ModelDef` 类型 + `ProviderRegistry`；OpenAI 兼容 SSE 流式 client（content/tool_calls/reasoning_content 解析、429/5xx 指数退避重试、[DONE] 即断流、总超时兜底）；DeepSeek provider（deepseek-chat/reasoner 目录、`DSCODE_BASE_URL`/`DSCODE_API_KEY` 主变量 + `DSAPI_BASE_URL`/`DSAPI_API_KEY` 兼容）；鉴权解析器（`--api-key` > auth.json > env，写 auth.json 0600，`DSCODE_HOME` 覆盖）。
- **证据**：单测 mock SSE 解析 + mock 429 重试通过；SC-1.1/SC-1.2 实测 PASS。
- **对应**：FR-1/FR-6、SC-1.1/SC-1.2

### M1-S3 工具层（`@dscode/core`）
- **完成时间**：2026-08-07
- **内容**：`Tool` 接口 + `ToolRegistry`（typebox schema + toOpenAITools）；`read`（offset/limit、图片附件、二进制嗅探）、`write`（建父目录）、`edit`（多 disjoint edit、oldText 唯一匹配、重叠检测）、`bash`（子进程、超时 SIGTERM→SIGKILL + taskkill /T、50KB 截断）、`glob`/`grep`（ripgrep 优先 + fallback）、`ls`；路径安全 `resolveWithin`/`tryResolve`（逃逸拒绝转 isError）。
- **证据**：SC-1.3~1.6 实测 PASS；工具单测全绿。
- **对应**：FR-3、SC-1.3/SC-1.4/SC-1.5/SC-1.6

### M1-S4 Agent Loop（`@dscode/core`）
- **完成时间**：2026-08-07
- **内容**：`AgentSession`（messages/loop 状态、run() 异步生成器主循环、dispose/abort、model getter/setter）+ `AgentSessionRuntime` factory；tool_call/tool_result 事件流（tool_call 先于执行发出）；并行工具执行 + 错误隔离（未知工具/非法 JSON/抛异常全部转 isError）；system prompt 组装（角色 + 工具 snippets + steering + DSCODE.md + extra，`DSCODE_DEBUG=1` 打日志）。
- **证据**：SC-1.7 实测 PASS（5 轮工具调用：bash 失败→read→edit→bash 通过）；maxTurns/abort 收敛单测。
- **对应**：FR-4/FR-7、SC-1.7

### M1-S5 交互模式（`@dscode/cli`，P0 部分）
- **完成时间**：2026-08-07
- **内容**：TUI 最小边界（readline 单行输入 + 滚动输出、流式渲染、Ctrl+C 中止、`/exit`）；slash 命令路由（/exit /help /model /cost /clear）；首次运行 key 引导（无 key 时交互提示输入并写 auth.json，stdin EOF 竞速防挂死）。
- **证据**：SC-1.9 实测 PASS（`/help` 列命令、`/exit` 退出码 0）；commands/args 单测。
- **对应**：FR-2.1/FR-8.1、SC-1.9

### M1-S6 print 模式
- **完成时间**：2026-08-07
- **内容**：`-p` 一次性首尾、stdin 管道（`-p -`）、纯文本流式输出、退出码反映成败（0 成功 / 1 工具失败 / 2 缺 prompt）。
- **证据**：SC-1.8 实测 PASS（管道输入非空输出）；print 单测 8 条。
- **对应**：FR-2.2、SC-1.8

### M1-S7 测试与文档
- **完成时间**：2026-08-07
- **内容**：`scripts/verify-m1.mjs` 一键跑 SC-1.1~1.10，PASS/FAIL/SKIP 表 + 失败项 dump turn 轨迹（每轮 tool_call + 结果 + 收敛原因）；`DSCODE_MODEL` / `DSCCODE_VERIFY_ONLY` 可配置；README 与快速上手；全量单元测试 22 文件 100 用例。
- **证据**：`pnpm verify` 实测 **SC-1.1~1.10 全 PASS**；`pnpm test` 100 绿；`pnpm -r build` 零错误。
- **对应**：SC-1.1~1.10、NFR-4

### 过程中修复的关键缺陷（经验沉淀）
- **SSE [DONE] 挂死**：部分代理发完 `[DONE]` 不关连接，client 须在 `[DONE]` 后立即结束读取（曾导致流式永不结束）。
- **timeoutMs 未接线**：`OpenAIClient.timeoutMs` 声明但未接 fetch，须作为 streamChat 总超时兜底。
- **tool_call 事件缺失**：AgentSession 只发 tool_result 不发 tool_call，违反事件设计，TUI 工具渲染永不触发。
- **rl.question EOF 挂死**：非交互 stdin EOF 时首次运行引导须用 question/close 竞速优雅返回。

---

## 经验沉淀

### 当前环境基线（落地前确认）
- Node v22.15.0 ✅
- Bun 1.3.11 ✅
- pnpm 10.32.1 ✅
- 用户环境已有 `DEEPSEEK_API_KEY` 之外，还有 `DSAPI_BASE_URL` / `DSAPI_API_KEY`（DeepSeek 兼容网关）——dscode 须兼容此对变量（已纳入 FR-1.3 / SC-1.2 范畴）。

### 风险登记
- pi 闭源，但 docs 与 dist 公开可读；借鉴设计须明确致谢，避免代码逐行抄写（dscode 为自主实现 + 独立命名）。
- DeepSeek 模型目录会变，需预留远端目录拉取（M3）。
- Windows 中文宽度与 IME 是已知名坑，M1 须早做 visibleWidth 测试。

---

## 下一动作

进入 todos-list.md Milestone 1 的 M1-S1（项目骨架），按依赖图关键路径推进。
