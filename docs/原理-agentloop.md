# 原理：Agent Loop

> 状态：v0.1（设计期，落地前以本文为准绳）
> 配套：架构文档.md §4.2（Agent Loop）/ 需求文档 FR-4 / 索引文档.md
> 本文回答：dscode 的心跳——prompt → LLM → tool_calls → 执行 → 反馈 → 再 LLM 的循环怎么转起来，tool call / function call 怎么落地，流式怎么解析，循环怎么收敛。

---

## 0. TL;DR

**Agent Loop 是 dscode 的发动机：LLM 不是"答一句就完"，而是可以调工具、看结果、再想、再调，直到任务收敛。**

1. **prompt 组装** → 角色 + 工具 schema + DSCODE.md + steering（架构文档 §4.2.7）。
2. **LLM 调用（流式）** → 边收边渲（TUI）/ 边收边出（print）。
3. **tool_calls 解析** → 从流式输出中解析出结构化 tool call（function call）。
4. **工具执行** → 过权限网关 → 执行（可并行）→ 得 tool_result。
5. **结果写回** → tool_result 作为新消息喂回 LLM。
6. **收敛判定** → 无 tool_call 或达上限（默认 50）→ `agent_end`。

围绕这条主线，本文覆盖：tool call / function call 的协议落地（§4-§5）、流式解析（§6）、权限网关（§7）、skills 按需加载（§8）、以及 sub-agent 复用形态（§10）。MCP 与 web search 已拆独立文档（原理-mcp.md / 原理-web-search.md）。

---

## 1. 为什么是"循环"

### 1.1 问题

一次"提问→回答"不够：真实任务要读文件、改文件、跑测试、看报错、再改。模型必须能**在对话中间调用外部工具，并把结果纳入后续推理**。

### 1.2 解法：tool_calls 协议

业界共识（OpenAI function calling / Anthropic tool use / DeepSeek 兼容 OpenAI）：LLM 输出里可以携带**结构化工具调用意图**（工具名 + 参数），宿主负责执行并把结果以 tool_result 消息回传。dscode 沿用 OpenAI 兼容协议（DeepSeek 新版已兼容），让多 provider 复用同一套解析。

---

## 2. 工作流总图

```
  用户输入
     │
     ▼
┌──────────────┐    DSCODE.md / steering / tools schema
│ prompt 组装   │◄──────────────────────────┐
└──────┬───────┘                            │
       ▼                                    │
┌──────────────┐  流式                      │
│ LLM 调用      │── message_update 逐 token ─┤ (TUI/print 消费)
└──────┬───────┘                            │
       ▼                                    │
┌──────────────┐                            │
│ 解析 tool_calls│                            │
└──────┬───────┘                            │
       ▼                                    │
┌──────────────┐  权限检查（allow/deny/ask）  │
│ 工具执行(并行) │                            │
└──────┬───────┘                            │
       ▼                                    │
┌──────────────┐  tool_result 写回 session   │
│ 结果回喂 LLM  │────────────────────────────┘
└──────┬───────┘
       ▼
  无 tool_call 或达上限 → agent_end / agent_settled
```

---

## 3. 循环主体与收敛

### 3.1 主循环

```ts
// 伪代码
while (turns < MAX_TURNS) {
  const resp = await llm.stream(messages, tools);
  if (resp.toolCalls.length === 0) break;      // 收敛：不再调工具
  const results = await Promise.all(           // 并行执行（默认）
    resp.toolCalls.map(tc => gateAndExecute(tc))
  );
  messages.push({ role: "tool", toolResults: results });
}
```

### 3.2 收敛判定

- **无 tool_call** → 模型决定直接回答 → 循环结束。
- **达上限**（默认 50，可配）→ 强制结束并提示（防止死循环）。
- 超长任务的兜底：见 原理-compact.md（压缩）与 原理-plan-and-execute.md（计划分解）。

### 3.3 并行执行

同一 assistant message 的多个 tool_call **默认并行**（Promise.all），错误隔离不连环崩（todos M1-S4）。可配置串行（依赖型工具链场景）。

---

## 4. tool call 与 function call 的关系

### 4.1 术语澄清

- **function call**：协议层概念——LLM 输出中声明"我想调用 `read(path=...)`"的结构化请求（function/tool 名 + 参数 JSON）。
- **tool call**：dscode 宿主层的执行单元——一个 function call 经过权限网关后真正执行，产生 tool_result。

**dscode 不区分两者为不同系统**：function call 是"意图声明"，tool call 是"意图落地"。一个 function call 执行后就是一个 tool call 记录。

### 4.2 落地形态（OpenAI 兼容）

```jsonc
// assistant message 里的 function call
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    { "id": "call_1", "type": "function",
      "function": { "name": "read", "arguments": "{\"path\":\"src/auth.ts\"}" } }
  ]
}
// 宿主执行后回传
{ "role": "tool", "tool_call_id": "call_1", "content": "<文件内容>" }
```

- `tool_call_id` 必须回传，LLM 才能把结果和意图对上。
- `arguments` 是 JSON 字符串：**可能不合法或缺失字段** → 宿主宽容解析（补默认值或报错让模型自愈）。

### 4.3 参数 schema

工具用 typebox schema 声明参数（todos M1-S3），随 prompt 组装进 tools 数组。schema 即"模型可用的契约"，也用于执行前校验。

---

## 5. 流式输出解析

### 5.1 双流：content + tool_calls

流式响应里，模型可能同时吐**正文 token**（content）和**工具调用增量**（tool_calls 分片）。dscode 解析两路：

- `content` 增量 → 逐 token 推给 TUI/print 渲染（`message_update` 事件）。
- `tool_calls` 增量（delta 拼接）→ 攒齐后组装完整 function call，不渲染为正文。

### 5.2 分片拼接

```ts
// delta 按 index 累积，拼完 name + arguments 后得到完整调用
const acc: Record<number, { name: string; args: string }> = {};
for (const delta of stream) {
  const tc = delta.tool_calls?.[0];
  if (!tc) continue;
  acc[tc.index] ??= { name: "", args: "" };
  acc[tc.index].name += tc.function?.name ?? "";
  acc[tc.index].args += tc.function?.arguments ?? "";
}
```

### 5.3 reasoning_content

DeepSeek reasoner 的思考过程走 `reasoning_content` 字段，与 content 分离：dscode 解析后独立展示（折叠/流式/隐藏，架构文档 §10 开放问题），**不混入正文**。

---

## 6. 工具执行与权限网关

### 6.1 执行链

```
function call → 权限检查(allow/deny/ask) → [ask 确认] → 执行 → tool_result
```

- 权限检查**在 execute 之前**（见 原理-沙盒执行.md §4）。
- `bash` 等危险工具在 ask 模式需用户确认（架构文档 §6）。
- 执行失败 → 返回结构化错误（含退出码/signal），喂回模型触发自愈（原理-plan-and-execute.md §9）。

### 6.2 错误隔离

- 并行工具一个失败不连坐其他。
- 单工具超时/崩溃不影响 AgentSession 存活。

---

## 7. skills 按需加载

- skills 不常驻 system prompt，**发现时渐进披露**（progressive disclosure）：按需注入指令/上下文。
- `/skill:lint` 之类显式触发，或任务相关时自动加载（todos M4，待 standalone 文档，索引文档登记）。

---

## 8. 生命周期事件

| 事件 | 时机 |
|------|------|
| `agent_start` | 首轮开始 |
| `message_update` | 每 token 增量 |
| `tool_call` / `tool_result` | 工具执行前后 |
| `agent_settled` / `agent_end` | 收敛 / 强制结束 |
| `session_before_compact` | 压缩前（见 原理-compact.md §8） |

事件供扩展订阅（FR-10），也供 json/rpc 模式输出结构化流。

> **观测点 = 事件流（M1 起）**：DEBUG 日志（NFR-4）与 M1 验收脚本统一消费同一事件总线，不做独立 instrumentation 层。验收脚本失败项 dump turn 轨迹 = 每轮 tool_call + 结果摘要 + 收敛原因（settled / max-turns / error），使 SC-1.7 长 loop 失败可定位"哪一轮、哪个工具、为什么停"。

---

## 9. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 循环收敛 | 无 tool_call 必结束；达上限强制结束并提示 |
| tool_call 解析 | mock SSE 解析出 content + tool_calls，`tool_call_id` 正确回传 |
| 流式渲染 | print 模式边收边输出，json 模式每行合法 `{type,data}` |
| 并行执行 | 两个独立 bash 并发完成时刻早于串行（todos M1-S4） |
| 权限前置 | 危险工具在 ask 模式先确认后执行，read-only 模式写工具 100% 拒 |

---

## 10. 反模式（明确不做）

- ❌ "tool_call 整包等完再解析"——必须流式解析，否则首 token 延迟爆炸。
- ❌ "arguments 非法就崩"——宽容解析 + 错误回喂模型自愈。
- ❌ "工具串行执行"（默认）——无依赖则并行。
- ❌ "权限执行后检查"——前置。
- ❌ "无限循环"——必须上限。

---

## 11. 与其他原理文档的衔接

- loop 的执行原语（read/grep/patch/delete/diff）见 原理-file-tools.md；bash 执行与沙盒见 原理-沙盒执行.md。
- 循环无限增长 → 触发 **compact**（下游）。详见 原理-compact.md。
- loop 是 **plan-and-execute 的底层机制**：plan 阶段是受限 loop（写工具 deny），execute 是带偏差校验的全功能 loop。详见 原理-plan-and-execute.md §11。
- 外部工具接入（MCP）见 原理-mcp.md；web search 见 原理-web-search.md。
- sub-agent 是 loop 的复用形态：独立 AgentSession 跑子 loop，结果回灌摘要。见 原理-plan-and-execute.md §6。