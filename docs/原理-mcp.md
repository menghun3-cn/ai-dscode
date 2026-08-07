# 原理：MCP（Model Context Protocol）

> 状态：v0.1（设计期，v0.6 落地，落地前以本文为准绳）
> 配套：架构文档.md §4.2.11 / 需求文档 FR-11 / 索引文档.md
> 本文回答：外部工具/资源怎么通过 MCP 接进 dscode——client 怎么连 server、工具/资源怎么注入、生命周期与错误怎么处理。

---

## 0. TL;DR

**MCP 是"外部世界"的标准化插口：任何第三方服务器（文件系统、数据库、浏览器、内部 API）只要实现 MCP 协议，dscode 就能把它的工具/资源注入到 Agent Loop 里，模型直接调用。**

1. **客户端**：dscode 作为 MCP client，通过 stdio（本地进程）或 HTTP（远程）连接 server。
2. **能力发现**：连上后拉取 server 声明的 tools / resources / prompts 三类能力。
3. **工具注入**：server 的 tools 转成 dscode 的 Tool 形态（typebox schema），并入模型可见的工具集。
4. **资源读取**：server 的 resources 作为"可读上下文"按需读取回传模型。
5. **执行路由**：模型调用 MCP 工具 → 权限网关 → 经 client 转发给 server → 结果回传。
6. **生命周期**：启动连接、`/reload` 热重连、异常重连、退出断开。

---

## 1. 为什么需要 MCP

### 1.1 问题

dscode 内置工具（read/grep/bash…）覆盖"文件与命令"，但真实世界还有：数据库、浏览器、云平台、内部系统。若每个都要 dscode 内置，永无尽头；若让扩展各写各的接入，生态碎片化。

### 1.2 解法：标准化协议

MCP 把"工具/资源/采样"三类能力标准化：server 声明能力，client 消费能力。**生态里已有大量现成 MCP server（官方 filesystem、GitHub、浏览器等）**，dscode 接一个协议就接进整个生态。

---

## 2. 连接与传输

### 2.1 两种传输

| 传输 | 场景 | 形态 |
|------|------|------|
| stdio | 本地子进程 server | `spawn` 子进程，JSON-RPC over stdin/stdout |
| HTTP | 远程 server | fetch JSON-RPC（SSE 或 streamable HTTP） |

- stdio 与 沙盒执行（原理-沙盒执行.md）同源：子进程、超时、信号、输出截断同一套治理。
- 远程 HTTP 走常规网络栈，注意 proxy/超时配置。

### 2.2 握手

- 启动时 `initialize` 交换协议版本与能力（client→server 的 capabilities）。
- 版本不兼容 → 明确报错，不静默降级。

---

## 3. 三类能力与注入

MCP 定义三类能力，dscode 消费其中两类进 loop：

### 3.1 tools（工具）

```ts
// server 声明 → dscode 转换 → 注入模型工具集
{ name, description, inputSchema /* JSON Schema */ }
```

- **转换**：inputSchema 转成 dscode 内部 schema（typebox 兼容）。
- **注入**：并入 `tools` 数组随 prompt 发给模型，与内置工具同权。
- **隔离命名**：多 server 同名工具 → 命名空间（如 `serverName.toolName`），防冲突。

### 3.2 resources（资源）

- 可读上下文（文件内容、查询结果），**不自动全量注入**（防撑爆 context），按需 `resources/read` 读取回传。
- 模型通过工具调用读取，或扩展按事件触发。

### 3.3 prompts（提示模板）

- v0.6 先不深度消费；预留为"server 提供的可复用提示"。

---

## 4. 执行路由

```
模型 tool_call: <serverName.toolName>(args)
  → 权限网关（allow/deny/ask，与内置工具同一套）
  → client 转发 tools/call 给对应 server
  → server 执行，返回结果（含 isError 标记）
  → tool_result 回喂模型
```

- **权限不豁免**：MCP 工具同样过权限网关，deny 规则/危险命令识别一样生效。
- **错误传播**：server 返回 isError → 结构化错误回传模型自愈，不伪装成功。
- **超时**：单次调用超时上限，防 server 挂死 loop。

---

## 5. 生命周期与配置

### 5.1 配置

- `.dscode/mcp.json`（项目）+ `~/.dscode/mcp.json`（全局）：server 清单（命令/URL、传输类型、env）。
- 项目级 MCP server 需 `project_trust` 显式信任（架构文档 §6）——同扩展机制。

### 5.2 生命周期

- 启动时按配置连接全部 server。
- `/reload` 热重连（改配置后生效，无需重启）。
- 异常断开 → 指数退避重连；连续失败 → 标记 disabled 并提示。

---

## 6. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 连接成功 | `initialize` 握手通过，能力清单拉取成功 |
| 工具注入 | 连官方 filesystem server 后，模型可见其暴露的工具 |
| 执行往返 | 模型调 MCP 工具 → server 执行 → 结果正确回喂 |
| 权限生效 | MCP 工具同样被 deny/ask 规则拦截 |
| 错误诚实 | server isError 如实回传，不伪装成功 |
| 重连可靠 | server 崩溃后自动重连成功，配置改动 `/reload` 生效 |

---

## 7. 反模式（明确不做）

- ❌ "MCP 工具豁免权限"——一律过网关。
- ❌ "resources 全量注入 context"——按需读取。
- ❌ "server 崩溃即整个挂"——隔离 + 重连。
- ❌ "版本不兼容静默降级"——明确报错。

---

## 8. 与其他原理文档的衔接

- MCP 工具最终汇入 **Agent Loop** 的工具集，走同一套 tool_call 协议。详见 原理-agentloop.md。
- 工具执行统一过**权限网关**与**沙盒治理**（子进程/超时）。详见 原理-沙盒执行.md。
- MCP 服务器声明 → 工具 schema 注入 prompt 组装（架构文档 §4.2.7）。
- 拆分触发：当出现"多 server + 资源/工具/采样三类各自展开"时，本文已独立成文（索引文档"待立项"登记同步移除）。