# 原理：扩展系统（Extension & Hook）

> 状态：v0.1（设计期，v0.4 落地，落地前以本文为准绳）
> 配套：架构文档.md §4.2.8 / 需求文档 FR-10 / 索引文档.md
> 本文回答：第三方怎么给 dscode 加工具、加命令、拦事件——事件总线、ExtensionAPI、加载方式、项目信任、热重载。

---

## 0. TL;DR

**扩展是 dscode"可扩展"承诺的落点：任何用户或团队都能用 TypeScript 给 dscode 加自定义工具、命令、快捷键，或订阅事件在关键节点插入逻辑。**

1. **事件总线**：`on(event, handler)` 订阅生命周期事件（tool_call / agent_start / message_update…），可 block 或改写。
2. **ExtensionAPI**：`registerTool` / `registerCommand` / `registerShortcut` / `registerFlag` + `ctx.ui`。
3. **加载**：jiti 原生加载 TS（免编译），全局 `~/.dscode/extensions/` + 项目 `.dscode/extensions/`。
4. **项目信任**：项目扩展需 `project_trust` 显式信任，未信任不加载。
5. **热重载**：`/reload` 重新加载扩展，改完即生效。

---

## 1. 为什么需要扩展系统

### 1.1 问题

- 内置工具（read/grep/bash…）覆盖通用场景，但真实团队有专属需求：自己的发布脚本、内部 API、定制命令。
- 若每次都要改 dscode 源码加功能，生态无法生长，团队无法自定制。
- 需要的不仅是"加工具"，还有"在关键时刻拦一下/改一下"——比如拦截危险 bash、注入上下文。

### 1.2 解法：事件 + 能力注册

借鉴 pi 的事件驱动 extension 模型（架构文档 §4.2.8）：**事件总线让扩展能"看到并干预"**，**注册 API 让扩展能"新增能力"**。两者配合，一个扩展既能加工具，也能在某些事件前拦截。

---

## 2. 事件总线

### 2.1 事件清单（核心子集）

```
session_start / session_shutdown / session_before_switch / session_before_compact
project_trust
before_agent_start / agent_start / agent_end / agent_settled
turn_start / turn_end
message_start / message_update / message_end
tool_call / tool_result / tool_execution_start/update/end
context / before_provider_headers / before_provider_request / after_provider_response
input / user_bash
model_select / thinking_level_select
before_export / before_share
```

### 2.2 订阅与干预

```ts
dscode.on("tool_call", async (e, ctx) => {
  if (e.toolName === "bash" && e.input.command.includes("rm -rf")) {
    const ok = await ctx.ui.confirm("危险", "允许 rm -rf?");
    if (!ok) return { block: true, reason: "用户拒绝" };
  }
});
```

- 处理器返回 `{ block: true, reason }` → 事件被拦截（工具不执行）。
- 返回改写对象（如 context 事件）→ 可修改将发送给 LLM 的内容。
- **异步**：处理器可 await 用户确认（`ctx.ui.confirm`）。

### 2.3 与内置 hook 的关系

权限、compaction 等内置机制也走同一事件总线（`session_before_compact` 见 原理-compact.md §8），扩展与内置能力**同构可互拦**。

---

## 3. ExtensionAPI

```ts
export default function (dscode: ExtensionAPI) {
  dscode.registerTool({ name: "greet", description: "...", parameters: schema, execute() {...} });
  dscode.registerCommand("hello", { handler: async (args, ctx) => {...} });
  dscode.registerShortcut("ctrl+k", { handler: () => {...} });
  dscode.registerFlag("--my-flag", { handler: () => {...} });
  dscode.on("agent_start", ...);
}
```

| API | 作用 |
|-----|------|
| `registerTool` | 加一个 Agent 可调用的工具（并入工具集，走同一执行/权限链） |
| `registerCommand` | 加一个 slash 命令（`/hello`） |
| `registerShortcut` | 加 TUI 快捷键 |
| `registerFlag` | 加 CLI 启动 flag |
| `on` / `ctx.ui` | 订阅事件 / 弹 select/confirm/input/notify/custom |

---

## 4. 加载与位置

- **全局**：`~/.dscode/extensions/*.ts`（个人通用）。
- **项目**：`.dscode/extensions/*.ts`（仓库专属，**需 project_trust 信任**才加载）。
- **加载器**：jiti（TS 原生，免编译、免构建步骤）。
- **默认导出**：扩展文件 `export default function(dscode: ExtensionAPI) {...}`。

### 4.1 项目信任

项目扩展 / 项目 MCP server 在加载前需显式信任（见 原理-permission.md §5）。未信任 → 不加载 + 日志提示，防"clone 一个仓库就自动跑它的代码"。

---

## 5. 热重载

- `/reload`：重新扫描并加载扩展（配置、扩展、MCP server 一起重载）。
- 改完扩展保存 → `/reload` 生效，无需重启 dscode（todos M4 验收）。

---

## 6. 与权限/沙盒的关系

- 扩展注册的工具**走同一权限网关**（不豁免），危险操作仍被 allow/deny/ask 拦。
- 扩展的 bash-like 操作不绕过沙盒治理（子进程/超时）——见 原理-沙盒执行.md。
- 扩展可订阅 `tool_call` 做**额外的自定义拦截**（叠加在权限之上）。

---

## 7. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 注册工具 | 扩展注册 `greet` 后 `dscode -p "调用 greet 问候 Alice"` 输出 `Hello, Alice!`（SC-4.1） |
| 事件拦截 | 扩展订阅 tool_call block 危险 bash，工具不执行且提示 reason |
| 加载正确 | 全局/项目扩展文件被 jiti 加载，默认导出执行 |
| 项目信任 | 未信任项目扩展不加载，日志可见提示 |
| 热重载 | 改扩展后 `/reload` 生效，无需重启 |

---

## 8. 反模式（明确不做）

- ❌ "扩展随便跑权"——工具走统一权限网关，项目扩展需信任。
- ❌ "扩展编译步骤"——jiti 原生 TS，免编译。
- ❌ "事件处理器同步阻塞主 loop"——允许异步，但不得无限挂起（有超时）。
- ❌ "扩展直接改 session/写内部状态"——走事件 + 注册 API，保可审计。

---

## 9. 与其他原理文档的衔接

- 扩展注册的工具汇入 **Agent Loop** 工具集，走同一 tool_call 执行链。详见 原理-agentloop.md。
- `session_before_compact` 事件让扩展自定义摘要。详见 原理-compact.md §8。
- 扩展工具/事件同样受**权限网关**约束。详见 原理-permission.md。
- 项目信任与 MCP server 信任共用机制。详见 原理-mcp.md §5。
- `ctx.ui` （confirm/select）是 TUI 的能力。详见 原理-tui.md。