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
> 后置 P1 打磨项（`@`/`!` 命令、中文宽度/IME）已于 2026-08-07 落地，见下方 M1-S5 P1 小节；M1 全部关闭。

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

### M1-S5 交互模式（P1：`@`/`!` 命令、中文宽度与 IME）
- **完成时间**：2026-08-07
- **内容**：输入展开 `expand.ts`——`@path` 文件引用、`!cmd` 命令注入，复用 readTool/runCommand（路径安全 + 超时 + 50KB 截断），`[文件]/[命令]` 标记内联；`width.ts`——`visibleWidth` 按码点计全角（中文/日文/emoji 不拆代理对）、`cursorCol`（IME 定位用列位置）、`truncateByWidth`（TUI 工具输出截断按列宽，不切全角）。
- **证据**：`@a.txt 你好` 展开含 a.txt 内容（单测）；visibleWidth('你好')=4 等单测 11 条；TUI 输入循环先 expand 再 run。
- **对应**：FR-2.1、SC-1.10（TUI 部分）

### M1-S6 print 模式
- **完成时间**：2026-08-07
- **内容**：`-p` 一次性首尾、stdin 管道（`-p -`）、纯文本流式输出、退出码反映成败（0 成功 / 1 工具失败 / 2 缺 prompt）。
- **证据**：SC-1.8 实测 PASS（管道输入非空输出）；print 单测 8 条。
- **对应**：FR-2.2、SC-1.8

### M1-S7 测试与文档
- **完成时间**：2026-08-07
- **内容**：`scripts/verify-m1.mjs` 一键跑 SC-1.1~1.10，PASS/FAIL/SKIP 表 + 失败项 dump turn 轨迹（每轮 tool_call + 结果 + 收敛原因）；`DSCODE_MODEL` / `DSCODE_VERIFY_ONLY` 可配置；README 与快速上手；全量单元测试 22 文件 100 用例。
- **证据**：`pnpm verify` 实测 **SC-1.1~1.10 全 PASS**；`pnpm test` 100 绿；`pnpm -r build` 零错误。
- **对应**：SC-1.1~1.10、NFR-4

### 过程中修复的关键缺陷（经验沉淀）
- **SSE [DONE] 挂死**：部分代理发完 `[DONE]` 不关连接，client 须在 `[DONE]` 后立即结束读取（曾导致流式永不结束）。
- **timeoutMs 未接线**：`OpenAIClient.timeoutMs` 声明但未接 fetch，须作为 streamChat 总超时兜底。
- **tool_call 事件缺失**：AgentSession 只发 tool_result 不发 tool_call，违反事件设计，TUI 工具渲染永不触发。
- **rl.question EOF 挂死**：非交互 stdin EOF 时首次运行引导须用 question/close 竞速优雅返回。

---

## Milestone 2：Session 持久化（v0.2）✅ 2026-08-07 落地

> 全部完成项从 todos-list.md 迁入（含后置 P1：/name 检索、/export 完善）。单测形态覆盖 SC-2.1~2.4。

### M2-S1 SessionManager + JSONL 格式（SC-2.1）
- **完成时间**：2026-08-07
- **内容**：`packages/core/src/session/`——`entries.ts`（SessionEntry 8 类：user/assistant/toolResult/compaction/branchSummary/modelChange/label/extension）、`manager.ts`（`~/.dscode/sessions/<cwd-hash>/<id>.jsonl`，DSCODE_HOME 可覆盖，JSONL 追加写，损坏行跳过，list/latestId/create）、`context.ts`（branchPath + buildContextEntries：激活分支 + compaction 折叠，modelChange/label 跳过）。
- **证据**：`session/manager.test.ts` 5 条（往返/损坏行/倒序/名字/fork）；SC-2.1 断言每行可 parse。
- **对应**：FR-5.1、SC-2.1

### M2-S2 resume/continue（SC-2.2）
- **完成时间**：2026-08-07
- **内容**：AgentSession 增 `sessionId`/`entries`/`activeBranch`/`prepare()` resume 加载；CLI `-c` 续最近会话、`-r` 列表交互选择恢复（`resolveSessionId`）；`persist()` 增量落盘（savedCount）。
- **证据**：`session.test.ts` resume 用例（同 sessionId 恢复历史含首轮 user 消息）。
- **对应**：FR-5.2、SC-2.2

### M2-S3 tree navigation（SC-2.3）
- **完成时间**：2026-08-07
- **内容**：`/tree` 查看会话树（编号/类型/预览）、`/tree <n>` 跳节点改写分支（`jumpTo`）；buildContextEntries 只沿激活分支折叠。
- **证据**：`session.test.ts` jumpTo 用例；`context.test.ts` 分支隔离 6 条。
- **对应**：FR-5.3、SC-2.3

### M2-S4 fork/clone（SC-2.4）
- **完成时间**：2026-08-07
- **内容**：`/fork <n>` 从历史节点生成新会话文件（旧文件不变）、`/clone` 复制当前分支为新会话（`forkFrom`/`clone`）。
- **证据**：`manager.test.ts` fork 语义用例（新文件内容一致、旧文件原样）。
- **对应**：FR-5.3、SC-2.4

### M2-S5 /name 命名与检索（后置 P1）
- **完成时间**：2026-08-07
- **内容**：`/name <名字>` 写 label entry；`SessionManager.list()` 带 `name`（最后一个 label）；`-r` 选择器与 `/resume` 显示「会话名」。
- **证据**：`manager.test.ts` list 带名字用例；`commands.test.ts` /name 用例。
- **对应**：FR-5.4

### M2-S6 /export 导出（后置 P1）
- **完成时间**：2026-08-07
- **内容**：`packages/cli/src/export.ts`——markdown 渲染器（会话 ID/名字/导出时间/节点数/模型切换/时间戳）+ HTML 渲染器（样式 + 转义）；`/export` 与 `/export html`。
- **证据**：`export.test.ts` 4 条（md 结构、html 骨架、XSS 转义）。
- **对应**：FR-5.5

### 过程中修复的关键缺陷（经验沉淀）
- **persist 只落最后一条**：resume 后历史缺失——改为 savedCount 增量全量追加。
- **SessionEntry.content 需允许 null**：assistant 仅 tool_calls 时 content 为 null。
- **listSessions 返回类型缺 name**：commands.ts 与 core SessionMeta 类型同步。

---

## Milestone 3：多 Provider（v0.3）✅ 2026-08-07 落地

> 全部完成项从 todos-list.md 迁入（含后置 P1 与 P2）。SC-3.1~3.3 单测形态 + 真实网关 /cost 实测。

### M3-S1 OpenAI/Anthropic provider（协议适配）
- **完成时间**：2026-08-07
- **内容**：`anthropic.ts`——Anthropic Messages client（SSE 统一解析：text→content、thinking→reasoning、tool_use→toolCalls、usage 随结束事件产出；独立停滞超时/重试）；`providers.ts`——openai（gpt-4o 系列）、anthropic（claude 系列）、local（Ollama/vLLM）+ `createDefaultProviders()` + `createClientFor()` 协议分派；`auth.ts` 新增 `resolveProviderApiKey`（auth.json 条目 > `${PROVIDER}_API_KEY`）。
- **证据**：`anthropic.test.ts` 3 条（text/thinking/tool_use 流式解析）；`providers.test.ts` 5 条（注册表 + 协议分派）。
- **对应**：FR-6.1/FR-6.2

### M3-S2 /model 与 --model 切换、Ctrl+P 循环（SC-3.1）
- **完成时间**：2026-08-07
- **内容**：`session.ts` clientFactory（setModel 跨 provider 换协议 client）；`build-session.ts` 按 --provider 选初始 provider、预解析全部 key、clientFactory 热切换（deepseek 尊重 DSCODE_BASE_URL 覆盖）；TUI `/model` 列出全部 9 个模型 + Ctrl+P 循环。
- **证据**：session 跨 provider 切换单测；交互实测 /model 列出 deepseek×3/gpt×2/claude×2/local×2。
- **对应**：FR-6.3、SC-3.1

### M3-S3 reasoning 模型展示（SC-3.2）
- **完成时间**：2026-08-07
- **内容**：TUI `/thinking stream|fold|off`（流式灰色 / 折叠一行 / 隐藏）；Anthropic thinking_delta → reasoningContent。
- **证据**：anthropic.test.ts thinking 解析用例；commands.test.ts /thinking 2 条。
- **对应**：FR-6.4、SC-3.2

### M3-S4 远端模型目录拉取与缓存（后置 P1）
- **完成时间**：2026-08-07
- **内容**：`models-store.ts`——fetch/update/read `~/.dscode/models-store.json`（DSCODE_HOME 覆盖）、mergeModels（同名覆盖/新模型追加）、syncModelsStore（启动合并缓存离线可用 + DSCODE_MODELS_URL 拉取，失败静默保旧）；CLI `/models-update` 手动刷新（动态重建模型列表与价格表）。
- **证据**：`models-store.test.ts` 6 条（URL/路径/拉取缓存/失败保旧/合并/离线回退）。
- **对应**：FR-6.1

### M3-S5 本地 OpenAI 兼容 provider（后置 P1）
- **完成时间**：2026-08-07
- **内容**：`createLocalProvider()`（默认 Ollama `http://localhost:11434/v1`，`DSCODE_LOCAL_BASE_URL`/`DSCODE_LOCAL_KEY` 可配，llama3.1/qwen2.5 目录）。
- **证据**：providers.test.ts local provider 用例。
- **对应**：FR-6.2

### M3-S6 计费统计与 /cost（SC-3.3）
- **完成时间**：2026-08-07
- **内容**：`/cost` 价格表从全 provider 模型目录动态取价（rebuildModelCost）；usage 由 agent_settled 携带（session 层累计）。
- **证据**：真实网关实测——`模型 deepseek-v4-flash · input 1445 tok · output 40 tok · cache 0 tok · 预估成本 $0.0004`。
- **对应**：FR-6.5、SC-3.3

### M3-S7 prompt cache（后置 P2，DeepSeek context caching）
- **完成时间**：2026-08-07
- **内容**：`cache_read_input_tokens` / `cache_creation_input_tokens` 全链路——OpenAIClient 透传 usage（types.ts StreamUsage）、Anthropic message_start 解析、session 跨轮累计、`/cost` 展示 cache 成本（cacheRead 价格表）。
- **证据**：client.test.ts usage 透传解析（cache_read=80）；session.test.ts 跨轮累计（read=80、creation=100）。
- **验收说明**：`重复 prompt 第二次 cacheRead > 0` 取决于上游——DeepSeek 官方 API 支持 context caching；本地 mock 网关（127.0.0.1:8000）不返回 cache 字段（实测两次均 cache 0），需官方 API 才能观察到正值。代码数据流已单测验证。
- **对应**：FR-6.5、SC-3.7

### 过程中修复的关键缺陷（经验沉淀）
- **Anthropic usage 只累计未产出**：message_start/delta 返回 undefined 不产出事件——改为 message_delta 结束事件附 `{...usage}`。
- **/mo 前缀匹配**：新增 /models-update 后 /mo 命中两个命令，补全断言同步。
- **dscodeHome 跨包引用**：ai 包不能反向依赖 core——models-store 内本地定义。

---

## Milestone 4：扩展系统（v0.4）✅ 2026-08-07 落地

> 全部完成项从 todos-list.md 迁入（M4-S1~S6，含后置 P1）。SC-4.1 单测形态 + 真实网关扩展工具实测。

### M4-S1 事件总线与 hook 协议
- **完成时间**：2026-08-07
- **内容**：`extension/events.ts`（扩展事件类型核心子集：tool_call/tool_result/agent_start/turn_*/message_update/model_select/project_trust 等）+ `extension/bus.ts`（EventBus：on/emit/block 拦截/unsubscribe/has）。
- **证据**：`bus.test.ts` 5 条（订阅/block 拦截/多 handler 截断/unsubscribe/has）；session.test.ts tool_call block 用例（扩展返回 `{block:true}` → 工具产出 `[blocked]` isError 结果）。
- **对应**：架构文档 §4.2.8 事件清单（核心子集先行）

### M4-S2 ExtensionAPI（SC-4.1）
- **完成时间**：2026-08-07
- **内容**：`extension/api.ts`——on/registerTool/registerCommand/registerShortcut/registerFlag；`extension/ui.ts`——ctx.ui（confirm/input/select/notify，默认控制台实现，CLI 可注入）。
- **证据**：`api.test.ts` 5 条（工具注册/重名报错/命令快捷键 flag/总线可达/ui 存在）。
- **对应**：SC-4.1

### M4-S3 扩展加载（jiti）+ 全局/项目位置 + hot reload
- **完成时间**：2026-08-07
- **内容**：`extension/loader.ts`——ExtensionManager（jiti 加载全局 `~/.dscode/extensions/*.ts` + 项目 `.dscode/extensions/*.ts`，项目需 trust；`/reload` 热重载）。
- **证据**：`loader.test.ts` 4 条（全局加载/项目 trust 行为/热重载替换/位置发现）。
- **关键坑**：jiti v2 无 `clearCache` 方法——热重载需逐键 `delete` 实例的 `cache` 属性（普通对象，非 Map）。
- **对应**：SC-4.2（改扩展后 /reload 生效）

### M4-S4 project_trust 机制
- **完成时间**：2026-08-07
- **内容**：`extension/trust.ts`——信任记录 `~/.dscode/trust.json`（DSCODE_HOME 覆盖）；buildSession 装配时对未信任项目弹交互确认（TTY）。
- **证据**：`trust.test.ts` 3 条（默认未信任/信任落盘/互不影响）；loader 未信任项目不加载且记录错误。
- **对应**：架构文档 §6、SC-4.3

### M4-S5 ctx.ui
- **完成时间**：2026-08-07
- **内容**：ctx.ui（confirm/input/select/notify）接口 + 默认控制台实现；扩展可通过 `dscode.ui` 弹确认框/输入/选择。
- **证据**：api.test.ts ui 存在性用例；consoleUi 兜底实现。
- **对应**：SC-4.4

### M4-S6 Skill 系统（后置 P1）
- **完成时间**：2026-08-07
- **内容**：`core/skill/skill.ts`——SkillManager（发现/加载全局 `~/.dscode/skills/*.md` + 项目 `.dscode/skills/*.md`，名字 `[\w.-]+` 防路径穿越；skill 仅为 prompt 文本不执行代码，故不强制 trust）；`AgentSession.applySkill()` 把指令追加进 system prompt（渐进披露，不常驻，见 原理-agentloop.md §7）；CLI `/skill:<名字>`（如 `/skill:lint`）+ `/skill` 列出。
- **证据**：`skill.test.ts` 4 条（聚合/加载/缺失/穿越防护）；commands.test.ts `/skill:lint` 3 条；session.test.ts applySkill 注入 1 条；真实网关实测 `/skill:lint` 返回"已加载 skill: lint"。
- **对应**：FR-7.2（skill 按需加载）、todos M4-S6 验收（`/skill:lint` 加载 lint 指令注入上下文）

### 过程中修复的关键缺陷（经验沉淀）
- **扩展工具模型不可见**：初版扩展工具只在 executeTool 回退，LLM 的 tools schema 不含它们——修复为 run() 把扩展工具并入 schema（实测模型成功调用 greet 工具）。另支持 supplier 形式，/reload 后新工具立即可用。
- **jiti v2 无 clearCache**：`clearCache`/`cache.clear` 均不存在——用逐键 `delete jiti.cache[k]` 实现热重载。
- **dscodeHome 双导出冲突**：extension/trust.ts 与 session/manager.ts 都导出 dscodeHome 导致 index 重导出歧义——trust.ts 改为从 manager 导入。

---

## Milestone 5：权限 / Plan / Sub-agent（v0.5）✅ 2026-08-08 落地

> 完成项从 todos-list.md 迁入（M5-S1~S5，含后置 P1 与 P0）。SC-4.2/4.3/4.4/4.5 单测形态 + 真实网关 /plan 实测。

### M5-S1 权限规则引擎 + 危险命令二次确认（SC-4.2 / SC-4.3）
- **完成时间**：2026-08-08
- **内容**：`permission/permission.ts`——危险命令检测（rm -rf / sudo / git push --force / mkfs / dd 裸设备 / shutdown / curl 管道执行等 8 类模式）；PermissionEngine（allow/deny 前缀匹配、ask=二次确认回调、full-auto autoApprove 跳过、无回调默认拒绝的安全兜底）；executeTool 集成（bash 危险命令 gate，扩展工具也过权限）。
- **证据**：`permission.test.ts` 7 条（检测命中/放行/默认拒绝/按用户决定/allow-deny 优先级/full-auto/持久化）。
- **对应**：SC-4.2（allow/deny/ask 子集）、SC-4.3

### M5-S2 Plan mode（SC-4.4）
- **完成时间**：2026-08-08
- **内容**：`plan/plan.ts`——PlanManager（只读模式 enter/accept + 步骤状态机 pending→done/failed + WRITE_TOOLS 写工具集）；executeTool 在 plan 激活时拒绝 write/edit；CLI `/plan` → `/plan-set` 步骤 → `/accept-plan` 落地。
- **证据**：`plan.test.ts` 3 条；session.test.ts plan 拦截/放行用例；真实网关实测 `/plan` → `/accept-plan` 均正常。
- **对应**：SC-4.4

### M5-S3 sub-agent（SC-4.5）
- **完成时间**：2026-08-08
- **内容**：`tools/task.ts`——task 工具；`ToolExecutionContext.subAgent` 工厂 + session.runSubAgent（隔离 AgentSession：独立 EventBus、persist=false、共享 cwd/工具/权限，结果截断 4KB 回灌主，见 原理-plan-and-execute.md §6）。
- **证据**：session.test.ts sub-agent 用例（主→task 调用→子会话消费一轮→摘要回传→主收敛）。
- **对应**：SC-4.5

### M5-S4 允许/拒绝列表持久化（后置 P1）
- **完成时间**：2026-08-08
- **内容**：`~/.dscode/permissions.json`（DSCODE_HOME 覆盖）读写 + `addPermissionRule`；CLI `/allow` / `/deny` 持久化规则（重启保留，新实例仍命中）。
- **证据**：permission.test.ts "重启规则保留"用例；commands.test.ts /allow /deny 用例。
- **对应**：todos M5 P1 验收（重启规则保留）

### M5-S5 审批模式分级（后置 P0，read-only/ask/auto-edit/full-auto）
- **完成时间**：2026-08-08
- **内容**：PermissionEngine 增 `mode`（ask 默认；autoApprove 兼容映射 full-auto）+ `writeTool` 上下文分派——read-only 拒写/拒危险、ask 写确认（无回调放行，print/CI 仍可编辑）+危险确认、auto-edit 编辑不弹框+危险仍确认（验收点）、full-auto 全放行；CLI `--approval <模式>` + `--auto-edit` 快捷 flag（显式 --approval 优先）+ 校验 + HELP；build-session 传 `mode: args.approval`。
- **证据**：args.test.ts 解析 2 条；permission.test.ts 四模式 4 条（read-only 拒写、ask 无回调放行/危险拒、auto-edit 编辑放行+危险确认、full-auto 全放行）；`--auto-edit` 启动实测。
- **关键坑**：ask 模式写工具无回调须放行（否则 print/CI 无法编辑文件），危险命令仍默认拒绝——安全与可用性的分界线。
- **对应**：todos M5-S5 验收（`--auto-edit` 启动后文件编辑不弹框、bash 仍弹）

### 过程中修复的关键缺陷（经验沉淀）
- **dscodeHome 双导出冲突（再现）**：permission.ts 又本地定义 dscodeHome 与 session/manager 冲突——改为从 manager 导入（M4 trust.ts 同款坑）。
- **checkPermission 返回值误用**：返回 string 原因却当对象用 `.reason`——修正为 `verdict !== null` 判定 + 字符串直接拼接。
- **scriptedClient 计数器跨 run 共享**：测试里一轮 run 会消费多轮 LLM 调用，第二次 run 无 tool_call——用例需按"每 run 消费 write+content 两轮"设计轮次。

---

## Milestone 6：Compaction（v0.6）✅ 2026-08-08 落地

> 全部完成项从 todos-list.md 迁入（M6-S1~S4，含 P1）。SC-5.1/5.2 单测形态 + 真实网关 /compact 实测。

### M6-S1 压缩算法（SC-5.1）
- **完成时间**：2026-08-08
- **内容**：`compact/compact.ts`——`estimateTokens`（启发式：中文 ~1.2/字、英文 ~0.25/char）、`selectCutPoint`（从最新倒着走保留最近 keepRecentTokens）、`summarizeMessages`（一次 LLM 调用产结构化摘要：目标/进度/关键文件/下一步）；`session.compact()`——emit session_before_compact → 选切点 → 摘要 → 写 compaction entry（M2 已建类型）→ 重建消息视图（`[压缩摘要]` user 消息 + 保留段）→ 落盘；LLM 摘要失败降级为截断文本兜底。
- **证据**：`compact.test.ts` 6 条（估算/cut point/摘要/失败降级）；session.test.ts 手动压缩用例（compaction entry 落盘、视图收缩）。
- **对应**：SC-5.1

### M6-S2 触发器（SC-5.2）
- **完成时间**：2026-08-08
- **内容**：`compactThreshold`（默认 40000，`DSCODE_COMPACT_THRESHOLD` env 覆盖）+ `maybeAutoCompact` 接入 run() 两个收敛点（no-tool-calls / max-turns，SC-5.1 自动压缩）；CLI `/compact [指令]` 手动压缩（附加指令如"重点保留测试上下文"传入摘要，SC-5.2）。
- **证据**：session.test.ts 自动压缩用例（阈值 2000 + 长消息 → compaction entry）；commands.test.ts /compact 用例。
- **对应**：SC-5.1（自动）、SC-5.2（手动）

### M6-S3 branch summary（后置 P1）
- **完成时间**：2026-08-08
- **内容**：`session.switchBranch()`——/tree 切分支时对"被弃尾段"（旧分支不在新路径的条目）写 branchSummary entry；`/tree <n>` 改走 switchBranch（原同步 jumpTo 保留）。
- **证据**：session.test.ts switchBranch 用例（branchSummary entry 落盘）；commands.test.ts /tree 用例。
- **对应**：原理-compact.md 附产品、todos M6 P1 验收（切回后关键事实保留）

### M6-S4 扩展自定义摘要（后置 P1）
- **完成时间**：2026-08-08
- **内容**：`session_before_compact` 事件（M4 已建类型）；handler 返回 `{ block:true, reason:<自定义摘要> }` 覆盖 LLM 摘要。
- **证据**：session.test.ts 扩展自定义摘要用例（未调 LLM，直接用扩展摘要）。
- **对应**：todos M6 P1 验收（扩展摘要覆盖默认）

### 过程中修复的关键缺陷（经验沉淀）
- **messages.length<=4 守卫冗余**：挡住自动压缩大单消息场景——`cutIndex===0` 检查已兜底小对话，移除守卫（并修 3 个测试：补轮次、加长消息到超 keepRecentTokens）。
- **?? 与 || 混用 TS 错**：`opts.compactThreshold ?? Number(env) || 40000` 需括号 `?? (Number(env) || 40000)`。
- **旧 /tree 测试过期**：/tree 改走 switchBranch 后旧断言（jumpTo + "已跳到节点"）失效——删除由新 M6 用例覆盖。

---

## Milestone 7：MCP 与 RPC（v0.7）✅ 2026-08-08 落地

> 完成项从 todos-list.md 迁入（M7-S1~S3）。rpc send→回复往返 + json 模式 SC-6.3 真实网关实测通过。

### M7-S1 MCP client + 工具注入
- **完成时间**：2026-08-08
- **内容**：`mcp/mcp-client.ts`——stdio 传输（spawn 子进程 + newline JSON-RPC 2.0）、initialize 握手（协议版本检查 + notifications/initialized）、tools/list、tools/call、id 匹配请求响应、close 生命周期；`mcp/mcp-tools.ts`——`wrapMcpTool`（JSON Schema → Type.Unsafe、`serverName.toolName` 隔离命名防冲突）、`registerMcpTools`；build-session 经 `DSCODE_MCP_SERVERS` env（JSON `{ name: { command, args } }`）装配，连接失败不阻塞启动。
- **证据**：`mcp-client.test.ts` 5 条（真实 stdio 假 server 握手/listTools/callTool 往返；隔离命名与执行转发；批量注册）。
- **对应**：FR-11、todos M7 P1（stdio 已落地；官方 filesystem server 实测需用户环境）

### M7-S2 rpc 模式（JSON-RPC over stdio）
- **完成时间**：2026-08-08
- **内容**：`rpc.ts`——`ping` / `send`（跑 Agent Loop，逐事件发 `event` 通知，回复最终文本）/ `quit`；未知方法 -32601；dispatcher 占位分支替换为 runRpc 分发。
- **证据**：`rpc.test.ts` 3 条（ping/事件流+回复往返/未知方法）；真实网关实测 `{"id":2,"result":{"reply":"…"}}` send→回复往返成功。
- **对应**：FR-11、todos M7 P1 验收（外部进程发 send 完成"提问→回复"往返）

### M7-S3 json 模式 event 流（后置 P2，SC-6.3）
- **完成时间**：2026-08-08
- **内容**：`json.ts`——`runJson` 逐事件输出一行 `{"type","data"}`（message_update/tool_call/tool_result/agent_settled 全事件序列化），复用 resolvePrintPrompt，注入流便于测试，退出码反映工具失败；dispatcher 占位替换为 runJson 分发；修复 `resolveMode`（显式非默认 `--mode` 优先于 `-p` 快捷，`-p "x" --mode json` 正确进 json）。
- **证据**：`json.test.ts` 3 条（每行可 parse 含 type/data、事件流含 agent_start/message_update/agent_settled、缺 prompt 返回 2）+ dispatcher 回归测试；真实网关实测 `-p - --mode json` 输出合法 `{type,data}` 事件行。
- **对应**：SC-6.3（每行 JSON.parse 通过、含 type/data 字段）

### 过程中修复的关键缺陷（经验沉淀）
- **readline async handler 不串行**：quit 抢先结束进程截断 send 回复——改为**处理链串行**（chain 逐个 then）。
- **stdin EOF 即退出**：管道关闭触发 close 立即 resolve——改为**等处理链 settle 后再结束**，避免截断 send 回复。

---

## Milestone 8：分发与发布（v1.0）✅ 2026-08-08 落地

> 完成项从 todos-list.md 迁入（M8-S1~S7）。SC-6.1/6.2/6.4 实测通过（SC-6.4 三平台全绿）。

### M8-S1 npm 全局包发布配置（SC-6.1）
- **完成时间**：2026-08-08
- **内容**：根 package.json 加 `bin: { dscode: "./dist/dscode-cli.js" }`、`files`、`prepublishOnly`（发布前构建）+ `bundle:cli`（bun 单文件 bundle）。
- **证据**：`npm pack` → `npm i -g` tarball → `dscode --version` 输出 `0.7.0`（registry 正式发布需 npm 账号授权）。
- **对应**：SC-6.1

### M8-S2 Bun 编译单二进制（SC-6.2）
- **完成时间**：2026-08-08
- **内容**：`build:binary`（`bun build --compile`）；CI/Release workflow 内置三平台编译。
- **证据**：`dist/dscode.exe`（Windows 327 模块）`--version` 正常。
- **对应**：SC-6.2

### M8-S3 curl 安装脚本
- **完成时间**：2026-08-08
- **内容**：`scripts/install.sh`——检测平台（Linux/macOS）→ 从 GitHub Releases 下载对应二进制（`dscode-linux-x64` / `dscode-macos`）→ 装到 `~/.dscode/bin`（`DCSCODE_INSTALL_DIR` 可覆盖）→ PATH 提示 + `--version` 校验；`curl ... | sh` 一键安装。
- **证据**：`bash -n` 语法检查通过；Windows 不支持在脚本内明示（提示下载 exe）。
- **对应**：todos M8 P1（`curl ... | sh` 装好）

### M8-S4 跨平台回归矩阵 CI（SC-6.4，workflow 就绪）
- **完成时间**：2026-08-08
- **内容**：`.github/workflows/ci.yml`——win/macOS/Linux 三平台矩阵：Node 22 + pnpm + Bun → install → build → test（SC-1.3~1.7）→ build:binary → 验证二进制 → 上传产物；`.github/workflows/release.yml`——tag `v*` 推送 → 三平台编译 → GitHub Release 附二进制（`dscode-linux-x64`/`dscode-macos`/`dscode-windows-x64.exe`）。
- **证据**：workflow 结构静态检查；**真实跑通待 GitHub Actions**（M8-S7 后置）。
- **对应**：SC-6.4

### M8-S5 完整中文文档 + 英文 README
- **完成时间**：2026-08-08
- **内容**：README.md 状态更新（v0.7，M1~M7 关闭）+ 三方式安装指引（npm / 二进制 / 源码）；新增 README.en.md（英文版：定位/状态/文档/安装/使用/License/致谢）。
- **证据**：README.en.md 存在且章节完整；README.md 安装节含 curl 一键安装。
- **对应**：todos M8 P1

### M8-S6 许可证与致谢（P0）
- **完成时间**：2026-08-08
- **内容**：`LICENSE`（MIT，Copyright (c) 2026 menghun3-cn）；README 致谢节——注明借鉴 pi / Claude Code / Codex CLI / Cursor / OpenCode / MCP 的设计理念，明确**独立自主实现、非逐行抄写**声明（对齐风险登记要求）。
- **证据**：LICENSE 存在；README 致谢节可读。
- **对应**：todos M8 P0

### M8-S7 跨平台回归矩阵实测（后置 P0，SC-6.4）
- **完成时间**：2026-08-08
- **内容**：`.github/workflows/ci.yml` 推送 master 后由 GitHub Actions 执行——win/macOS/Linux 三平台各跑 install → build → test（SC-1.3~1.7）→ build:binary → 验证二进制。
- **证据**：**ubuntu-latest / macos-latest / windows-latest 三平台全绿**（用户于 Actions 页确认）；`dscode` 二进制三平台产出成功（SC-6.2 跨平台成立）。
- **对应**：SC-6.4（三平台全绿）

### 过程中修复的关键缺陷（经验沉淀）
- **凭据守卫拦截**：PowerShell 实测时把 API key 写进 `-Command` 字符串参数被凭据守卫拦截——key 应走环境变量前缀，不经 shell 参数（SC-6.4 Windows 实测的教训）。

---

## 横切项验收记录（持续项，2026-08-09 v1.0 发布前）

### 性能守门（NFR-1/2，预算：冷启动 ≤200ms / 长会话内存 ≤200MB）
- **NFR-1 冷启动**：实测 `time dscode --version` 稳定态 **113ms / 119ms ≤ 200ms** ✅（首次 343ms 为冷缓存，此后稳定 ~115ms）。
- **NFR-2 内存**：长输出任务运行中采样 WorkingSet，稳定 **158~165MB ≤ 200MB** ✅。
- **结论**：NFR 表绿，不阻塞发布。

### 安全审计（无 high 级漏洞）
- **key 存储 0600**：`auth.ts` L77-79 `fs.writeFile(..., { mode: 0o600 })` + `chmod 0600` 兜底（Windows 尽力 chmod，ACL 由系统查，SC-1.1）；auth.test 通过。
- **危险命令拦截**：`permission.ts` 8 类危险模式（rm -rf / sudo / git push --force / mkfs 等）+ PermissionEngine 二次确认 + executeTool 拦截；permission.test（7+4 条）通过。
- **项目信任**：trust.json 机制 + loader 未信任项目不加载；trust.test + loader.test 通过。
- **审计方式**：安全相关 4 个测试文件 26 条全绿（auth / permission / trust / loader）。
- **结论**：无 high 级漏洞，发布级约束满足。

### 日志与可观测（P1，NFR-4）
- **内容**：`core/observability/logger.ts`——`createDebugLogger` 在 AgentEvent 消费点写入 `~/.dscode/logs/<时间戳>-<session>.log`（JSONL，每行 `{ts,type,data}`）；agent_settled 含 reason（收敛原因）与 usage（每轮 input/output/cache token）；观测点=事件流，不做独立 instrumentation 层。
- **接线**：四个模式（print / json / rpc / tui）的 run 循环 `logger.log(ev)` + finally close。
- **证据**：`DSCODE_DEBUG=1` 实测产出日志（`agent_start`/`reasoning_update`/`"reason":"no-tool-calls"`）；logger.test 3 条。
- **修复的坑**：`createWriteStream` 不建父目录——先 `mkdirSync(logs)` 否则日志静默丢失。
- **对应**：NFR-4（含每轮收敛原因 + usage 附加判据）

### 错误体验（P1）
- **内容**：`cli/errors.ts` `friendlyError`——网络/限流错误（429/5xx/ECONNREFUSED/fetch failed/停滞）附"稍后重试，检查 DSCODE_BASE_URL/代理"；其余附"DSCODE_DEBUG=1 查看详细日志"；index.ts 顶层 catch 不再裸栈（仅 DEBUG 模式给堆栈）。
- **接线**：print / json / rpc / tui 四处错误路径全部使用 friendlyError。
- **证据**：errors.test 3 条（含"不泄露堆栈"断言）。
- **对应**：todos P1 验收（制造 429/网络断 UI 不崩——错误被 catch 且提示友好，不崩）

### 编辑后 diff 快照（P2，原理-file-tools.md §6 diff 对账落地）
- **完成时间**：2026-08-20
- **内容**：`core/src/util/diff.ts`——无依赖行级 unified diff（LCS 扁平 Int32Array DP + 掐头去尾快路径 + `LCS_LIMIT=1M` 有界回退防大文件爆内存；`@@` hunk 头 / 空格/-/+ 前缀行 / added-removed 统计）；`edit` 与 `write`（覆盖已存在文件）成功后计算"改前 vs 改后"快照：output 附 `（+N -M）` 统计，metadata 带 `diff` 文本与 `diffStats`；`AgentEvent.tool_result` / `ToolCallOutcome` / EventBus 负载携带 `metadata`，json/rpc 序列化器透传；TUI `tool_result` 成功结果着色展示（- 红 / + 绿 / @@ 青 / ---+++ 灰）。
- **证据**：diff.test 7 条（含新文件 `@@ -0,0`、CRLF、相邻 hunk 合并、1500×1500 有界回退）；edit/write 工具测试补 metadata 断言；tui.test 补 renderDiffText/renderEventText 断言；`pnpm typecheck` 零错误 + `pnpm test` 47 文件 332 用例全绿。
- **对应**：FR-3.2/FR-3.3、原理-file-tools.md §6/§9（diff 可审计：每次 patch 后必有 diff 快照）

### TUI 任务清单（P2，输入框上方显示任务清单与完成情况）
- **完成时间**：2026-08-20
- **内容**：`cli/src/tui-render.ts`——`TaskItem`/`TaskStatus` 模型 + `TuiModel.tasks`；`applyTaskEvent` 纯函数从 agent 事件流归集（tool_call → running、tool_result → done/failed，plan 步骤由 tui.ts 以 pending 预置为底座）；`taskTitleOf` 提炼短标题（path/command/pattern 优先）；`taskRowsOf`/`MAX_TASK_ROWS=5`（超量显示最新 N 条 + "共 N 项"提示行）；`renderLayout` 任务区渲染在输入框上方（运行状态行之上），`fixedRowsFor`/`cursorRow`/`scrollOutput` 同步计入任务区高度；`cli/src/tui.ts` 交互循环事件驱动更新任务清单并重绘。
- **证据**：tui-render.test 32 条（新增 taskTitleOf/taskRowsOf/applyTaskEvent/renderLayout 任务区 10 条，含状态着色、超量提示、菜单共存、无任务不占行）；`pnpm typecheck` 零错误；`pnpm test` 47 文件 341 用例（唯一失败为 packages/ai client 空闲超时 flaky 计时用例，单独跑 10/10 通过，与本次改动无关）。
- **对应**：FR-2.1（interactive TUI）、原理-agentloop.md §8（事件流即观测点）

### 输入框超长软换行（P2，修复超长输入被截断不换行）
- **完成时间**：2026-08-21
- **内容**：`cli/src/tui-render.ts`——`inputWrap` 折行工具（按可见宽度折行，首行扣除 prompt 宽、续行缩进 2，不拆 CJK/emoji）；`inputRowsOf`/`MAX_INPUT_HEIGHT` 高度有界；`inputCursorToPos` 折行网格感知（baseRow 累加前面逻辑行折行数，含 prompt 占位）；`inputPromptWidth`；`renderLayout` 输入段改为折行渲染 + 窗口锚定光标（超高时滚动显示尾部、光标始终可见），`fixedRowsFor`/`scrollOutput`/PgUp/PgDn 同步传入 COLS 与 prompt 宽。
- **证据**：tui-render.test 46 条（新增 inputWrap/inputRowsOf/inputPromptWidth/inputCursorToPos/renderLayout 折行 14 条，含 CJK 折行、折行边界光标、多逻辑行 baseRow、超高窗口锚定）；`pnpm typecheck` 零错误；`pnpm test` 47 文件 355 用例（唯一失败为 packages/ai flaky 计时用例，单独跑 10/10 通过）。
- **对应**：FR-2.1（interactive TUI 多行输入）

### 滚轮乱码修复（P2，SGR 鼠标字节漏进输入行）
- **完成时间**：2026-08-21
- **内容**：`cli/src/tui-render.ts` 新增 `isSgrFragment`（SGR 鼠标序列/分片识别：前缀完整、前缀被剥完整形如 `64;9;35M`、前缀被剥部分形三字段 `64;9;35`、buf 非空续接）；`cli/src/tui.ts` 鼠标拦截提前到 key 判定之前——滚轮/点击字节一律消费不落输入行（原实现 sgrShaped 只认 `\x1b[<` 开头或 `^[\d;]+[Mm]$`，分片或 key=undefined 时落入 origTtyWrite 产生乱码），非滚轮事件也消费不滚动。
- **证据**：tui-render.test 46 条（新增 isSgrFragment 6 条：分片到达、前缀剥离、非滚轮点击消费、纯数字/两字段不误判）；`pnpm typecheck` 零错误；`pnpm test` 47 文件 355 用例（唯一失败为 packages/ai flaky 计时用例，单独跑 10/10 通过）。
- **对应**：FR-2.1（interactive TUI 鼠标滚轮回看）

### 底部状态栏长目录截短修复（P2，CJK 长目录按可见宽度截短 + 预算分配）
- **完成时间**：2026-08-21
- **内容**：`cli/src/tui.ts`——`shortenPath` 改用**可见宽度**（visibleLen，CJK/emoji 计 2 列）判定与截短（保留末尾 + 省略号），根治"34 个中文字符按 .length 判定原样返回、实际渲染宽 68 列导致状态行被截断"；`statusBarText` 与 `setStatus` 改为**预算分配**——先量固定段（⏳/[plan]/「name」/↑↓/R CH/ctx）与右侧模型名占用，剩余宽度全给目录（`Math.max(4, …)`），模型名/token 统计不再被长目录挤掉，整行不超 COLS 不触发渲染层硬截断。
- **证据**：tui.test 25 条（新增 4 条：CJK 可见宽度截短不拆字、全角路径超 34 截短、预算分配后模型名/统计保留 + 行不超宽、`visibleLen(t) ≤ cols`）；`pnpm typecheck` 零错误；`pnpm test` 47 文件 358 用例全绿（首次 1 失败为 packages/ai flaky 计时用例，重跑通过）。
- **对应**：FR-2.1（interactive TUI 状态行）

### 底部目录完整显示（P2，两行式底部：完整目录行 + 状态行分离）
- **完成时间**：2026-08-21
- **内容**：需求变更"目录要求显示全"——放弃截短方案，改两行式底部：`TuiModel` 新增 `cwd`（完整路径，不截短）；`renderLayout` 在菜单区后、状态行上方渲染完整目录行（超宽仅由 truncateAnsi 兜底截断，不挤压其他行）；`setStatus` 拆分——`model.cwd = session.cwd` 完整路径，状态行只保留 ⏳/[plan]/「name」/↑↓/R CH/ctx + 右 model（不再含目录）；`statusBarText` 同步移除 cwd 段（目录走独立行）；`fixedRowsFor`/`FIXED_ROWS`/`renderLayout` 高度联动 +1（FIXED_ROWS 5→6），scrollOutput/PgUp/PgDn 自动跟随。
- **证据**：tui-render.test + tui.test 73 条（新增/更新：帧结构含完整目录行、cwd 完整原样显示、超宽兜底截断不挤压状态行、输出滚动/回看锚定/跟随模式偏移随 FIXED_ROWS 更新、statusBarText 状态行不含目录无省略号）；`pnpm typecheck` 零错误；`pnpm test` 47 文件 360 用例全绿。
- **对应**：FR-2.1（interactive TUI 状态行/目录展示）

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
