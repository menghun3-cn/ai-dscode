# DSCODE Todos List

> 版本：v0.1 · 滚动维护，完成项迁入 todos-done.md
> 配套：架构文档.md / 需求文档.md / 成功标准.md
> 状态标记：`TODO` 待做 · `DOING` 进行中 · `BLOCKED` 阻塞 · `DONE` 完成（迁 done 文件）

---

## 状态约定

每条 todo 格式：
```
- [ ] [P0] [M1] <标题> — <一句话目标> → 验收：<对应 SC-* / 自检命令>
  - 子步骤 / 备注
```

- **P0/P1/P2/P3**：阻断项 / 重要 / 提升 / 可延后。
- **[Mx]**：所属里程碑。
- 所有条目须可追溯到需求文档 FR-* 与成功标准 SC-*。

---

## Milestone 1：MVP 闭环（v0.1）

> 部署avisma：DeepSeek 单 provider + 四工具 + interactive/print

### M1-S1 项目骨架
- [ ] [P0] [M1] 初始化 pnpm monorepo — 三个包 `@dscode/core` / `@dscode/ai` / `@dscode/cli` 的 workspace、tsconfig、vitest → 验收：`pnpm i` 成功，`pnpm -r build` 零错误
  - [ ] `pnpm-workspace.yaml`、根 `tsconfig.base.json`（target ES2022、module nodenext）
  - [ ] 三包各带 `package.json`、`tsconfig.json`、`src/index.ts`
  - [ ] 根 vitest 配置，跑空测试套件绿
- [ ] [P0] [M1] CLI 入口与 args 解析 — `@dscode/cli` bin `dscode`，解析 `-p/--print`、`--mode`、`--provider`、`--model`、`--api-key`、`-c/-r`、`@file` 引用 → 验收：`dscode --help` 列出全部参数；`dscode -p hi` 进入 print 分支
- [ ] [P0] [M1] 模式分发器 — 根据 args 选 interactive/print/json/rpc，print 与 interactive 先落地，json/rpc 占位 → 验收：四分支命中正确（日志可见 mode）

### M1-S2 Provider 层（`@dscode/ai`）
- [ ] [P0] [M1] Provider 接口与注册 — 定义 `Provider`/`ModelDef` 类型与 `ProviderRegistry` → 验收：`new Registry().register(deepSeekProvider)` 不报错
- [ ] [P0] [M1] OpenAI 兼容 streaming client — 实现 OpenAI Chat Completions 流式（SSE 解析），支持 `tool_calls` → 验收：单元测试 mock SSE，解析出 content + tool_calls
- [ ] [P0] [M1] DeepSeek provider 实现 — 基于 OpenAI 兼容 client，baseUrl `https://api.deepseek.com`，内置 `deepseek-chat`/`deepseek-reasoner` 目录 → 验收：`dscode --provider deepseek --model deepseek-chat -p hi` 返回非空
  - [ ] `reasoning_content` 字段解析（reasoner 模型）
  - [ ] 兼容 `DSAPI_BASE_URL`/`DSAPI_API_KEY` 环境变量
- [ ] [P0] [M1] 鉴权解析器 — 优先级：`--api-key` > `auth.json` > env；写 `auth.json`（0600） → 验收：SC-1.1/SC-1.2 通过
- [ ] [P0] [M1] 重试与限流 — 429/5xx 指数退避，最大 3 次 → 验收：mock 429 后第二次 200 成功

### M1-S3 工具层（`@dscode/core`）
- [ ] [P0] [M1] Tool 接口与注册器 — `Tool` 类型 + `ToolRegistry`，typebox schema → 验收：注册 read 后 `getAll()` 含之
- [ ] [P0] [M1] `read` 工具 — 读文件，offset/limit，图片作为 image 附件回传 → 验收：SC-1.3
- [ ] [P0] [M1] `write` 工具 — 创建/覆盖，建父目录 → 验收：SC-1.4
- [ ] [P0] [M1] `edit` 工具 — 多 disjoint edit，oldText 唯一匹配，重叠检测报错 → 验收：SC-1.5；额外：单文件两次 edit 不覆盖
- [ ] [P0] [M1] `bash` 工具 — 子进程执行，超时/信号/cwd/输出 truncation（50KB） → 验收：SC-1.6；`bash sleep 100` 配 `timeout:1` 能被中断
- [ ] [P0] [M1] `glob` / `grep` 工具 — glob(fast-glob)、grep(优先 ripgrep fallback 正则) → 验收：单测各工具 basic case；MVP 必备（无搜索则 Agent 定位代码靠 read 瞎猜）
- [ ] [P1] [M1] `ls` 工具 — 列目录 → 验收：单测 basic case

### M1-S4 Agent Loop（`@dscode/core`）
- [ ] [P0] [M1] AgentSession 与 Runtime 骨架 — `AgentSession`（持有 messages/loop 状态）+ `AgentSessionRuntime` factory → 验收：能 new + dispose 无异常
- [ ] [P0] [M1] Agent Loop 主循环 — 实现 prompt→LLM→tool_calls→execute→反馈→再 LLM，达无 tool_call 或上限结束 → 验收：SC-1.7
- [ ] [P0] [M1] 流式渲染回调 — 暴露 message_update 流，TUI/print 各自消费 → 验收：print 模式边收边输出
- [ ] [P1] [M1] 并行工具执行 — 同 assistant message 多 tool_call 并发，错误隔离不连环崩 → 验收：两个独立 bash 并发完成时刻早于串行
- [ ] [P1] [M1] System prompt 组装 — 角色 + 工具 snippets + DSCODE.md（若存在）+ steering → 验收：`DSCODE_DEBUG=1` 日志可见组装后 prompt

### M1-S5 交互模式（`@dscode/cli`）
- [ ] [P0] [M1] TUI 最小可用 — **最小边界：单行输入 + 滚动输出**，ANSI raw mode、流式输出渲染、`Ctrl+C` 中断、`/exit` 退出；**不做**组件树/`@`引用/`!`命令/IME（P1 打磨项，防 TUI 拖死 MVP） → 验收：SC-1.9
- [ ] [P0] [M1] slash 命令路由 — `/exit` `/help` `/model` `/cost` `/clear` 先落地 → 验收：`/help` 列命令、`/exit` 退出码 0
- [ ] [P1] [M1] `@` 文件引用、`!` 跑命令 — 输入框 `@path` 插文件内容、`!cmd` 跑 shell 注入上下文 → 验收：`@a.txt 你好` 模型看得到 a 内容
- [ ] [P1] [M1] 中文宽度与 IME — visibleWidth 计全角、IME 候选框定位 → 验收：SC-1.10

### M1-S6 print 模式
- [ ] [P0] [M1] print 模式完整 — `-p`、stdin 管道、纯文本输出退出码 → 验收：SC-1.8；退出码反映成功/失败

### M1-S7 测试与文档
- [ ] [P0] [M1] M1 验收脚本 — 一键脚本跑 SC-1.1~1.10，输出 PASS/FAIL 表；**失败项 dump turn 轨迹**（每轮 tool_call + 结果摘要 + 收敛原因 settled/max-turns/error），使失败可诊断 → 验收：全 PASS 且无盲区（无"PASS 但不知道为啥过"）
- [ ] [P1] [M1] README 与快速上手 — 安装、配 DeepSeek、hello world → 验收：新人按 README 10 分钟跑通

---

## Milestone 2：Session 持久化（v0.2）

- [ ] [P0] [M2] SessionManager + JSONL 格式 — entry 类型、tree 结构、自动保存 → 验收：SC-2.1
- [ ] [P0] [M2] resume/continue — `dscode -c`/-r、`/resume`、`/new` → 验收：SC-2.2
- [ ] [P0] [M2] tree navigation — `/tree` 跳节点改写分支、branch summary → 验收：SC-2.3
- [ ] [P0] [M2] fork/clone — `/fork`/`/clone` 生成新 session → 验收：SC-2.4
- [ ] [P1] [M2] `/name` 命名与检索 → 验收：`-r` 列表显示名字
- [ ] [P1] [M2] `/export` 导出 markdown → 验收：导出文件可读

---

## Milestone 3：多 Provider（v0.3）

- [ ] [P0] [M3] OpenAI/Anthropic provider — Chat Completions + Messages 协议适配 → 验收：`/model` 切到 GPT/claude 提问成功
- [ ] [P0] [M3] `/model` 与 `--model` 切换、Ctrl+P 循环 → 验收：SC-3.1
- [ ] [P0] [M3] reasoning 模型展示 — `reasoning_content` 折叠/流式 → 验收：SC-3.2
- [ ] [P1] [M3] 远端模型目录拉取与缓存 `~/.dscode/models-store.json` → 验收：拉取后离线可用
- [ ] [P1] [M3] 本地 OpenAI 兼容 provider（Ollama/vLLM） → 验收：连本地 Ollama 提问成功
- [ ] [P1] [M3] 计费统计与 `/cost` → 验收：SC-3.3
- [ ] [P2] [M3] prompt cache 支持（DeepSeek context caching） → 验收：重复 prompt 第二次 cacheRead token > 0

---

## Milestone 4：扩展系统（v0.4）

- [ ] [P0] [M4] 事件总线与 hook 协议 — 见架构文档事件清单，核心子集先行 → 验收：扩展能订阅 tool_call 并 block
- [ ] [P0] [M4] ExtensionAPI — on/registerTool/registerCommand/registerShortcut/registerFlag → 验收：SC-4.1
- [ ] [P0] [M4] 扩展加载（jiti）+ 全局/项目位置 + hot reload `/reload` → 验收：改扩展后 `/reload` 生效
- [ ] [P0] [M4] project_trust 机制 — `.dscode/extensions` 需确认 → 验收：未信任的项目扩展不加载，日志提示
- [ ] [P0] [M4] ctx.ui — select/confirm/input/notify/custom component → 验收：扩展可弹确认框
- [ ] [P1] [M4] Skill 系统与 prompt 模板 → 验收：`/skill:lint` 加载 lint 指令注入上下文

---

## Milestone 5：权限 / Plan / Sub-agent（v0.5）

- [ ] [P0] [M5] 权限规则引擎 — allow/deny/ask，glob + 命令前缀匹配 → 验收：SC-4.2
- [ ] [P0] [M5] 审批模式分级 — read-only/ask/auto-edit/full-auto → 锗收：`--auto-edit` 启动后文件编辑不弹框、bash 仍弹
- [ ] [P0] [M5] 危险命令二次确认 — `rm -rf`/`sudo`/`git push --force` 始终确认（除 full-auto+allow） → 验收：SC-4.3
- [ ] [P0] [M5] Plan mode — `/plan` 只读，写工具被拒；`/accept-plan` 落地 → 验收：SC-4.4
- [ ] [P0] [M5] sub-agent（`task` 工具）— 隔离 AgentSession 执行，结果回传主 → 验收：SC-4.5
- [ ] [P1] [M5] 允许/拒绝列表持久化 `~/.dscode/permissions.json` → 验收：重启规则保留

---

## Milestone 6：Compaction（v0.7）

- [ ] [P0] [M7] 压缩算法 — LLM 摘要旧消息写 compaction entry → 验收：SC-5.1
- [ ] [P0] [M7] 触发器 — 阈值/manual/overflow → 验收：SC-5.2
- [ ] [P1] [M7] branch summary — `/tree` 切分支时摘要被弃分支 → 验收：切回后关键事实保留
- [ ] [P1] [M7] 扩展自定义摘要 — `session_before_compact` 返回自定义 → 验收：扩展摘要覆盖默认

---

## Milestone 7：MCP 与 RPC（v0.6 续 / v1.0）

- [ ] [P1] [M8] MCP client — 连 stdio/HTTP MCP server，注入工具/资源 → 验收：连官方 filesystem MCP server 后模型可读其暴露文件
- [ ] [P1] [M8] rpc 模式 — JSON-RPC over stdio，命令集对齐 interactive → 验收：外部进程发 `send`/`recv` 完成"提问→回复"往返
- [ ] [P2] [M8] json 模式 event 流 — 每行 `{type,data}` 标准化 → 验收：SC-6.3

---

## Milestone 8：分发与发布（v1.0）

- [ ] [P0] [M9] npm 全局包发布配置 — `bin`、`files`、`prepublish` 构建 → 验收：SC-6.1
- [ ] [P1] [M9] Bun 编译单二进制 — `bun build --compile` 三平台产物 → 验收：SC-6.2
- [ ] [P1] [M9] curl 安装脚本 → 验收：`curl ... | sh` 装好
- [ ] [P0] [M9] 跨平台回归矩阵 — Win/macOS/Linux 跑 SC-1.3~1.7 → 验收：SC-6.4
- [ ] [P1] [M9] 完整中文文档 + 英文 README → 验收：docs 全套存在且索引可用
- [ ] [P0] [M9] 许可证与致谢（注明借鉴 pi/Claude Code 等设计）

---

## 跨里程碑横切项（持续）

- [ ] [P0] [ALL] 性能预算守门 — 每个 milestone 末跑 NFR-1/2，超预算阻塞发布 → 验收：NFR 表绿
- [ ] [P0] [ALL] 安全审计 — key 存储、危险命令、项目信任，每 milestone 自检 → 验收：无 high 级漏洞
- [ ] [P1] [ALL] 日志与可观测 — `DSCODE_DEBUG=1` 全链路日志，结构化 → 验收：NFR-4；**观测点=事件流**：DEBUG 日志与 M1 验收脚本统一消费事件总线（message_update/tool_call/agent_settled），不做独立 instrumentation 层
- [ ] [P1] [ALL] 错误体验 — 中文友好错误、可重试提示、不裸栈给用户 → 验收：制造 429/网络断 UI 不崩

---

## 开放问题（需决策，不阻塞 M1）

> 见架构文档 §10，决策后转 todo。
- [ ] [P2] [M3] 沙箱系统级隔离（landlock/seatbelt）是否进 v1？
- [ ] [P2] [M4] 是否同时识别 CLAUDE.md/AGENTS.md 降迁移成本？
- [ ] [P2] [M3] agent 分工（廉价规划 + 强执行）是否做？
- [ ] [P2] [M3] prompt cache 计费展示？
- [ ] [P1] [M1] DSCODE.md 默认内容模板（中文版）？

---

## 依赖图（关键路径）

```
M1-S1 骨架 ──► M1-S2 provider ──┐
              M1-S3 工具 ────────┼─► M1-S4 agent loop ─► M1-S5/S6 模式 ─► M1 验收
M2 session ◄── 依赖 M1 loop & provider
M3 多provider ◄── 依赖 M1 provider 抽象
M4 extension ◄── 依赖 M1 事件雏形 + M2 session
M5 权限/plan ◄── 依赖 M4 hook
M7 compaction ◄── 依赖 M2 session + M3 provider（用于摘要 LLM 调用）
M8 mcp/rpc ◄── 依赖 M4 工具注册 + M1 模式分发
M9 分发 ◄── 依赖 全部
```

**关键路径**：M1 骨架→provider→工具→loop 是最长链，必须服务于 M1 内闭环。
