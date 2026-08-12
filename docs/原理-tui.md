# 原理：TUI 与运行模式（渲染）

> 状态：v0.2（2026-08-10 重构落地——全屏差分渲染，对齐 pi 架构；v0.1 的"增量 ANSI 修补"路线已废弃）
> 配套：架构文档.md §3.3 §4.2.9 / 需求文档 FR-2 FR-13 / 索引文档.md
> 本文回答：自研终端 UI 怎么渲染——全屏差分渲染、中文宽度、流式输出、交互输入，以及 interactive / print / json / rpc 四种模式怎么分工。

---

## 0. TL;DR

**dscode 的 CLI 体验是把"流式输出 + 工具调用过程"以终端友好的方式呈现给用户。TUI 是核心，但四种模式（interactive / print / json / rpc）各司其职，print/json 保证 headless/CI 同等公民。**

1. **自研 TUI（对齐主流 CLI 架构）**：模型驱动全帧渲染 + alternate screen，不依赖 ink/React。
2. **差分渲染**：渲染层对比新旧帧**只重写变更行**（pi 同款），流式不闪烁。
3. **纯函数渲染层**（`tui-render.ts`）：布局逻辑与终端 I/O 完全解耦，**可完整单测**——根治"改一行引一 bug"。
4. **中文适配**：`visibleLen` 计全角宽度、`truncateAnsi` ANSI 感知截断。
5. **四种模式**：interactive（TUI）/ print（`-p` 纯文本）/ json（`--mode json` 事件流）/ rpc（JSON-RPC over stdio）。

---

## 1. 为什么自研 TUI

### 1.1 问题

- ink（React for CLI）功能强，但依赖 React 运行时，体积与启动开销对 CLI 不友好（冷启动目标 <200ms，NFR-1）。
- 中文宽度、IME、逐 token 流式这些**中文场景硬需求**，通用框架不一定照顾得好。

### 1.2 解法：极简自研

自研一套"模型驱动全帧渲染"的轻量 TUI。渲染架构借鉴主流 AI IDE CLI（**pi 的组件树 + 差分渲染**、Claude Code/Codex 的全屏拥有），但保持极简——不引终端框架依赖，完全掌控 IME、主题、渲染时序。

---

## 2. 渲染架构：全屏差分渲染（对齐 pi）

> 此节是 v0.2 重构的核心。v0.1 的"增量 ANSI 修补"（在滚动流上绝对定位 + 与 readline 光标博弈）已被废弃——它在不同终端反复引发光标错位/固定行丢失，且渲染逻辑无法单测。

### 2.1 分层（与 pi 同构）

| 层 | 文件 | 职责 |
|----|------|------|
| **纯渲染层** | `tui-render.ts` | `renderLayout(model, cols, rows) → 完整帧`（纯函数，无终端 I/O）——布局可完整单测 |
| **渲染器** | `tui.ts` `render()` | 差分写屏：对比上一帧，**只重写变更行**；`process.nextTick` 批量合并同 tick 的多次更新 |
| **输入层** | readline（空输出 sink） | **只做输入编辑**（`rl.line`/`rl.cursor`），渲染完全由本层拥有——消除 readline 光标冲突 |
| **终端会话** | `tui.ts` | alternate screen（`\x1b[?1049h`）、隐藏光标、鼠标事件模式（`?1000h?1006h`）启停 |

### 2.2 布局（模型驱动全帧）

```
[输出区]（滚动：尾部可视行 + PgUp/PgDn/鼠标滚轮回看 outputScroll）
──────────── 上分隔线
dscode> 输入（单行默认；Shift+Enter 多行，动态展开 ≤5 行）
[菜单保留区]（固定 4 行：输入框下方，→ 选中 + 描述，↑↓ 滚动窗口）
──────────── 下分隔线
状态行（左：cwd ↑↓R CH 已用/窗口；右：model，两端对齐）
```

- **模型** `TuiModel`：`outputLines / outputScroll / input / inputCursor / menu / status / busy`——所有变更走模型 → `render()`。
- **固定行**（分隔线/输入/菜单区/状态）**永不移动**（菜单是固定保留区）——这是"输入行随菜单上移导致 readline 光标错乱"这一历史 bug 的根治。

### 2.3 差分渲染

- 首帧全量写；之后对比 `prevFrame.lines` 与当前帧，**只重写变化的行**（`\x1b[${row};1H` + 行 + `\x1b[K`）。
- `process.nextTick` 批量：同 tick 多次变更（如流式多 chunk）合并为**一次**渲染，I/O 显著减少 → 流式不闪烁。
- 每帧渲染结束把硬件光标定位到输入行（`renderLayout` 返回 `cursorRow/cursorCol`）。

### 2.4 关键设计取舍（踩过的坑）

- **readline 输出到空 sink**：readline 只做行编辑（`line`/`cursor` 更新），其自身渲染不再上屏——渲染完全由本层拥有，光标位置 100% 可控。
- **终端信息启动时缓存**（`TTY/ROWS/COLS`）：Bun 在 readline terminal 模式**之后**查询 `process.stdout.rows/columns/isTTY` 会**同步阻塞**（启动挂起），必须在 createInterface 之前缓存。
- **鼠标滚轮**：SGR 鼠标模式（`\x1b[<64/65;x;yM`）解析为输出回看滚动（`parseSgrMouse` 纯函数）。
- **调试轨迹写文件**（`~/.dscode/logs/tui-debug.log`）：不用 stderr——PowerShell 会把原生 stderr 包装成错误记录刷屏。

---

## 3. 中文适配（FR-13）

### 3.1 中文字符宽度

- 全角字符（中文、日文、全角标点）在终端占 **2 列**，半角占 1 列。
- 用 `visibleLen`（去 ANSI 后按 Unicode 属性计宽）而非 `str.length` 做对齐/截断。
- `truncateAnsi`：**ANSI 感知截断**——跳过转义序列计宽、CJK 计 2 列、截断在样式区内时补闭合 `\x1b[0m`（防颜色污染下一帧行）。
- 验收：SC-1.10 / SC-6.4（中文在 TUI 不截断、不错位）。

### 3.2 IME（输入法）

- 输入框需正确处理 IME 合成状态：候选框定位、未确认的拼音不触发命令。
- 回车区分"确认 IME 候选"与"提交整行"（readline terminal 模式自带合成态处理）。

---

## 4. 流式输出渲染

- 消费 Agent Loop 的 `message_update` 事件（见 原理-agentloop.md §5）：**内联追加**到输出最后一行（`appendInline`），逐 chunk 累积进模型 → 差分渲染。
- 离散输出（回显 `> 问题`、slash 结果、工具调用、错误、耗时）**独占新行**（`appendLine`）——与流式内联严格区分，避免"问题被拼到上一条输出行尾"的历史 bug。
- reasoning：`stream`（灰色流式）/ `fold`（`[思考中…]` 一次）/ `off` 三态，`/thinking` 切换。

---

## 5. 四种运行模式

| 模式 | 触发 | 用途 | UI |
|------|------|------|----|
| interactive | `dscode`（默认） | 日常交互 | 全屏差分渲染 TUI |
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

- **输入**：单行默认；**Shift+Enter 插入换行展开多行**（≤5 行，续行缩进）。
- **slash 命令**：输入 `/` 弹出**固定保留区菜单**（4 行窗口，↑↓ 滚动查看更多，`→` 选中 + 描述，回车执行/Esc 关闭）；`/model` 打开模型选择器（↑↓ 选择 + Enter 应用）。
- **`@文件` 补全**：`@前缀` 匹配 cwd 文件（复用菜单机制）。
- **快捷键**：`Ctrl+P` 循环切模型、`Ctrl+R` 历史菜单、`Ctrl+C` 中断（运行中）/退出（空闲）。
- **输出回看**：`PgUp`/`PgDn` 或**鼠标滚轮**（SGR 鼠标模式）滚动输出区。
- **粘贴安全**：快速连续多行（120ms 窗口）折叠为单行并提示，防逐行误执行。
- `@path` 文件引用、`!cmd` 跑命令注入上下文（FR-2.1，expandInput）。

---

## 7. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 冷启动 | interactive 首屏 <500ms（Node），单二进制 <100ms（NFR-1） |
| 差分渲染 | 流式返回无整屏闪烁（只重写变更行）；纯渲染层单测覆盖帧结构/滚动/菜单/截断/光标 |
| 中文不错位 | 全角字符对齐正确，SC-1.10 通过；`truncateAnsi` 单测覆盖 |
| 流式可见 | TUI 边收边渲（内联），`Ctrl+C` 可中断 |
| 输入稳定 | 输入行固定不随菜单移动；`/` 后光标不错位；Shift+Enter 多行 |
| 回看 | PgUp/PgDn/鼠标滚轮可查看历史输出 |
| print 完备 | stdin 管道输入非空摘要（SC-1.8），退出码反映成败 |
| json 合法 | 每行 `{type,data}` `JSON.parse` 通过（SC-6.3） |

---

## 8. 反模式（明确不做）

- ❌ "依赖 ink/React 运行时"——自研轻量 TUI。
- ❌ **"增量 ANSI 修补"**（在滚动流上绝对定位 + 与 readline 光标博弈）——v0.1 路线，反复引发光标错位/固定行丢失，已废弃。改为**全屏差分渲染 + 模型驱动**。
- ❌ **"输入行随菜单高度移动"**——菜单用**固定保留区**，输入行永不移动（根治 readline 光标错乱）。
- ❌ **"readline 负责渲染"**——readline 空输出 sink，渲染完全自持。
- ❌ "中文按 `str.length` 对齐"——必须 visibleLen。
- ❌ "print 是残废模式"——print 同等公民。
- ❌ "IME 未确认拼音触发命令"——正确处理合成状态。

---

## 9. 与其他原理文档的衔接

- TUI 消费 **Agent Loop** 的 `message_update` / `tool_call` 事件流。详见 原理-agentloop.md §5-§6。
- `ctx.ui`（confirm/select/input）是 TUI 能力，供**扩展**调用。详见 原理-extension.md。
- 四种模式共享同一 Agent Loop / Provider / Session，只是渲染与协议不同。
- 中文宽度/IME 是**中文场景打磨**（FR-13）的核心，见 需求文档.md。
