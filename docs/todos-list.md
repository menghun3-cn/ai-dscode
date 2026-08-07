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

## Milestone 2：Session 持久化（v0.2）✅ 已完成

> **状态：2026-08-07 落地（SC-2.1~2.4 单测形态通过，含后置 P1）。**
> M2 全部完成项（含 /name 检索、/export 完善）已归档至 [todos-done.md](todos-done.md) §Milestone 2。

---

## Milestone 3：多 Provider（v0.3）✅ 已完成

> **状态：2026-08-07 落地（SC-3.1~3.3 单测形态 + 真实网关 /cost 实测，含后置 P1 与 P2）。**
> M3 全部完成项（含 prompt cache 数据流）已归档至 [todos-done.md](todos-done.md) §Milestone 3。

---

## Milestone 4：扩展系统（v0.4）✅ 已完成

> **状态：2026-08-07 落地（SC-4.1 单测形态 + 真实网关扩展工具实测；M4-S1~S6 全部完成，含后置 P1）。**
> M4 全部完成项已归档至 [todos-done.md](todos-done.md) §Milestone 4。

---

## Milestone 5：权限 / Plan / Sub-agent（v0.5）✅ 已完成

> **状态：2026-08-08 落地（SC-4.2/4.3 权限规则与危险命令二次确认、SC-4.4 Plan 只读、SC-4.5 sub-agent；含 P1 规则持久化与后置 P0 审批模式分级）。**
> M5 全部完成项已归档至 [todos-done.md](todos-done.md) §Milestone 5。

---

## Milestone 6：Compaction（v0.6）✅ 已完成

> **状态：2026-08-08 落地（SC-5.1 自动压缩、SC-5.2 手动压缩；含 P1 branch summary 与扩展自定义摘要）。**
> M6 全部完成项已归档至 [todos-done.md](todos-done.md) §Milestone 6。

---

## Milestone 7：MCP 与 RPC（v0.7）✅ 已完成

> **状态：2026-08-08 落地（MCP client stdio + 工具注入；rpc 模式 JSON-RPC over stdio；json 模式 event 流，SC-6.3 实测通过）。**
> M7 全部完成项已归档至 [todos-done.md](todos-done.md) §Milestone 7。

---

## Milestone 8：分发与发布（v1.0）✅ 已完成

> **状态：2026-08-08 落地（SC-6.1 npm 配置、SC-6.2 单二进制、curl 安装脚本、英文 README、MIT 许可证与致谢）。**
> M8 完成项已归档至 [todos-done.md](todos-done.md) §Milestone 8。
> SC-6.4 跨平台实测（macOS/Linux）依赖 GitHub Actions 执行 CI 后补验，后置不阻塞 M8 关闭。

### M8-S7 跨平台实测（后置，待 GitHub Actions）
- [ ] [P0] [M9] 跨平台回归矩阵实测 — CI workflow 已就绪；推送到 master 后由 GitHub Actions 在 win/macOS/Linux 跑通 SC-1.3~1.7 → 验收：SC-6.4

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
