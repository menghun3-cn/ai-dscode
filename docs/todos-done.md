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

## Milestone 1：MVP 闭环

> 尚未启动。M1 todo 全部位于 todos-list.md，完成后逐条迁本节。

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
