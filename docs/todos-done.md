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
