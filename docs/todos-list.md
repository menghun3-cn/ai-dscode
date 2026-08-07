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

## Milestone 1：MVP 闭环（v0.1）✅ 已完成

> **状态：2026-08-07 验收通过（SC-1.1~1.10 全 PASS，真实网关实测）。**
> M1-S1~S7 全部完成项已归档至 [todos-done.md](todos-done.md) §Milestone 1。
> 原后置 2 个 P1 打磨项（`@`/`!` 命令、中文宽度/IME）已于 2026-08-07 落地并归档，M1 全部关闭。

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
