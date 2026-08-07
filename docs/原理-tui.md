# 原理：TUI 与运行模式（渲染）

> 状态：v0.1（设计期，v0.1 落地 interactive/print，落地前以本文为准绳）
> 配套：架构文档.md §3.3 §4.2.9 / 需求文档 FR-2 FR-13 / 索引文档.md
> 本文回答：自研终端 UI 怎么渲染——增量渲染、中文宽度、IME、流式输出，以及 interactive / print / json / rpc 四种模式怎么分工。

---

## 0. TL;DR

**dscode 的 CLI 体验是把"流式输出 + 工具调用过程"以终端友好的方式呈现给用户。TUI 是核心，但四种模式（interactive / print / json / rpc）各司其职，print/json 保证 headless/CI 同等公民。**

1. **自研 TUI**：组件树 + ANSI 渲染 + 键盘事件（约 800-1500 行），不依赖 ink/React。
2. **增量渲染**：组件缓存 + `invalidate()`，仅状态变化时重绘，避免全屏重绘闪烁。
3. **中文适配**：`visibleWidth` 计全角字符宽度、IME 候选框定位。
4. **流式渲染**：`message_update` 逐 token 边收边渲（见 原理-agentloop.md §5）。
5. **四种模式**：interactive（TUI）/ print（`-p` 纯文本）/ json（`--mode json` 事件流）/ rpc（JSON-RPC over stdio）。

---

## 1. 为什么自研 TUI

### 1.1 问题

- ink（React for CLI）功能强，但依赖 React 运行时，体积与启动开销对 CLI 不友好（冷启动目标 <200ms，NFR-1）。
- 中文宽度、IME、逐 token 流式这些**中文场景硬需求**，通用框架不一定照顾得好。

### 1.2 解法：极简自研

自研一套"组件树 + ANSI 渲染 + 键盘事件"的轻量 TUI（架构文档 §3.3）。完全掌控 IME、主题、增量渲染。等 TUI 成熟再拆 `@dscode/tui` 包（架构文档 §4.1 注）。

---

## 2. 增量渲染模型

- **组件树**：UI 由组件构成，组件持有状态。
- **缓存 + invalidate**：组件仅在状态变化时标记失效并重绘对应的行区块，**不整屏重刷新**（避免闪烁与性能浪费，架构文档 §7）。
- 流式输出：每来一个 token 增量 `invalidate()` 对应输出区，只重绘该区。

---

## 3. 中文适配（FR-13）

### 3.1 中文字符宽度

- 全角字符（中文、日文、全角标点）在终端占 **2 列**，半角占 1 列。
- 用 `visibleWidth`（按 Unicode 属性计算）而非 `str.length` 做对齐/截断，否则中文会错位。
- 验收：SC-1.10 / SC-6.4（中文在 TUI 不截断、不错位）。

### 3.2 IME（输入法）

- 输入框需正确处理 IME 合成状态：候选框定位、未确认的拼音不触发命令。
- 回车区分"确认 IME 候选"与"提交整行"。

---

## 4. 流式输出渲染

- 消费 Agent Loop 的 `message_update` 事件（见 原理-agentloop.md §5），逐 token 追加渲染。
- 工具调用（tool_call）渲染为可读卡片（`renderCall` / `renderResult`，见架构文档 §4.2.5 Tool 接口）。
- reasoning 模型：`reasoning_content` 独立折叠/流式/隐藏呈现（架构文档 §10 开放问题）。

---

## 5. 四种运行模式

| 模式 | 触发 | 用途 | UI |
|------|------|------|----|
| interactive | `dscode`（默认） | 日常交互 | TUI |
| print | `dscode -p "..."` | 一次性首尾 / 管道 `/CI` | 纯文本输出 |
| json | `dscode --mode json` | 结构化事件流，CI 友好 | 每行 `{type,data}` |
| rpc | `dscode --mode rpc` | 进程集成（IDE 扩展宿主） | JSON-RPC over stdio |

### 5.1 print 同等公民

- print 模式不是"残废 TUI"，而是**独立完备**：支持 `-p`、stdin 管道（`echo ... | dscode -p -`）、纯文本输出、按成败给退出码（FR-2.2）。
- 确保 CI/headless 友好（借鉴 Cursor CLI headless 优先理念）。

### 5.2 json / rpc

- json：事件流标准化为 `{type, data}`，供 CI 消费（SC-6.3：每行 `JSON.parse` 通过）。
- rpc：JSON-RPC over stdio，命令集对齐 interactive，让未来写"dscode 的 VSCode 扩展"成为可能（FR-2.4）。

---

## 6. 交互输入

- 单行/多行输入、`@path` 文件引用、`!cmd` 跑命令注入上下文（FR-2.1）。
- slash 命令路由：`/exit` `/help` `/model` `/cost` `/clear`（todos M1-S5）。
- `Ctrl+C` 中断当前流式输出、`/exit` 退出（SC-1.9）。

> **MVP 最小边界（v0.1）**：interactive 只要求"单行输入 + 滚动输出"，能流式渲染、能中断、能退出即可（SC-1.9）。多行输入、`@path` 引用、`!cmd`、IME 候选框定位均为 P1 打磨项，**不阻塞 M1 关闭**——防 TUI 打磨拖死 MVP。中文宽度（visibleWidth）仍属 MVP（SC-1.10）。

---

## 7. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 冷启动 | interactive 首屏 <500ms（Node），单二进制 <100ms（NFR-1） |
| 增量渲染 | 长输出无整屏闪烁，仅变化区重绘 |
| 中文不错位 | 全角字符对齐正确，SC-1.10 通过 |
| 流式可见 | TUI 边收边渲，`Ctrl+C` 可中断 |
| print 完备 | stdin 管道输入非空摘要（SC-1.8），退出码反映成败 |
| json 合法 | 每行 `{type,data}` `JSON.parse` 通过（SC-6.3） |

---

## 8. 反模式（明确不做）

- ❌ "依赖 ink/React 运行时"——自研轻量 TUI。
- ❌ "整屏重绘"——增量渲染。
- ❌ "中文按 `str.length` 对齐"——必须 visibleWidth。
- ❌ "print 是残废模式"——print 同等公民。
- ❌ "IME 未确认拼音触发命令"——正确处理合成状态。

---

## 9. 与其他原理文档的衔接

- TUI 消费 **Agent Loop** 的 `message_update` / `tool_call` 事件流。详见 原理-agentloop.md §5-§6。
- `ctx.ui`（confirm/select/input）是 TUI 能力，供**扩展**调用。详见 原理-extension.md。
- 四种模式共享同一 Agent Loop / Provider / Session，只是渲染与协议不同。
- 中文宽度/IME 是**中文场景打磨**（FR-13）的核心，见 需求文档.md。