# AGENTS.md — DSCODE

DSCODE 是一个对接 DeepSeek 优先、兼容多模型、中文友好的命令行 AI 编码助手（AI IDE CLI）。**本仓库当前处于立项/设计阶段，只有 `docs/` 文档，没有源码，也不是 git 仓库。** 当前交付物就是文档本身。

## 没在代码里，先看文档

- 一切从 `docs/索引文档.md` 入口定位你要的文档。
- `docs/架构文档.md`：What/How（三包划分、Agent Loop、权限、里程碑）。
- `docs/需求文档.md`：给谁/做什么（FR-* 需求）。
- `docs/成功标准.md`：每条 SC-* 都是**可执行验证**（禁止"体验流畅"这类愿望），带 ID/验证手段/通过判据。
- `docs/todos-list.md`：滚动 todo，每条带 P0-P3 优先级 + [Mx] 里程碑 + 对应 SC/FR；完成项迁入 `docs/todos-done.md`。
- 三份原理文档（`原理-agentloop.md` / `原理-compact.md` / `原理-plan-and-execute.md`）解释机制心智模型。

## 文档维护铁律（易踩坑）

- **新增文档必须在 `docs/索引文档.md` 登记一行**；改名/合并必须全局搜引用并同步索引。
- **不要直接删过时文档**：先在 todos-list 标 DEPRECATED，无引用后再移除并在 done 归档。
- 命名约定：工程类 `<主题>文档.md`；原理类 `原理-<主题>.md`（主题用英文短词）。
- 所有新增 todo 必须可追溯到 FR-* 与 SC-*。

## 技术方向（写代码前先对齐）

- 计划技术栈：pnpm monorepo + TypeScript（target ES2022, module nodenext）+ Node 22 + vitest；Bun 编译单二进制分发。
- 三包：`@dscode/core`（agent loop/工具/权限）、`@dscode/ai`（provider）、`@dscode/cli`（TUI/print/json/rpc 模式）。
- 协议优先 OpenAI 兼容；DeepSeek 一等公民（`deepseek-chat`/`deepseek-reasoner`，reasoning 走 `reasoning_content`）。
- 关键路径：M1 骨架→provider→工具→loop，必须先服务 M1 内闭环。
- **默认中文**：system prompt、错误信息、文档、TUI 中文宽度（全角）与 IME。

## 验收节奏

- 每个 milestone 结束跑全量 SC 扫描输出表格（ID|状态|证据），落到 todos-done；未通过项转可见 todo 并带 blocker。