# 原理：文件工具（File Tools）

> 状态：v0.1（设计期，落地前以本文为准绳）
> 配套：架构文档.md §4.2.4（工具层）/ 需求文档 FR-3 / 索引文档.md
> 本文回答：dscode 的五个文件工具——读文件、搜索文件内容、补丁、删除、diff——各自怎么落地、边界在哪、怎么保证"改得稳、查得准、删得安全"。

---

## 0. TL;DR

**文件工具是 Agent 改动代码仓库的主要抓手。它们的共同敌人是"模型对文件系统的一厢情愿"——猜路径、整文件覆盖、误删、改错位置。dscode 用五个工具把"改文件"这件事拆成有边界、可回滚、可对账的原语：**

| 工具 | 职责 | 一句话边界 |
|------|------|-----------|
| `read` | 读 | offset/limit 分片读，图片作为 image 附件回传 |
| `grep` | 搜 | 优先 ripgrep，fallback 正则；返回命中行 + 上下文 |
| `patch` | 改 | 多 disjoint edit，oldText 全文唯一匹配，重叠检测报错 |
| `delete` | 删 | 只删指定路径，父目录不连带删，危险路径有 deny 保护 |
| `diff` | 对账 | 呈现"改前 vs 改后"，是 patch/delete 的审计与回滚依据 |

围绕"读/搜/改/删/对账"这条主线，本文展开：每个工具的输入输出 schema、边界条件、失败模式，以及它们如何服务 Agent Loop 与权限网关。

---

## 1. 为什么需要一组文件工具

### 1.1 问题

CLI 里让模型"改文件"，若只给一个笼统的 `file_edit`，会有：
- **整文件覆盖**：模型把 2000 行文件 rewrite 一遍，diff 爆炸、cache 打碎、易引入意外改动。
- **猜路径**：模型"觉得"文件在别处，写错路径。
- **定位困难**：没有 grep 就找不到"某某函数在哪定义"。
- **不可对账**：改完说不清改了什么，无法审计、无法回滚。

### 1.2 解法：单一职责原语

Claude Code（Read/Write/Edit/Glob/Grep）、Codex（apply_patch）、Aider（多文件 edit）的共识：**把"改文件"拆成读、搜、改、删、对账几个独立、可控的原语**，每个原语误差可控、可被权限拦截、可被 diff 对账。dscode 采纳这一拆分，并补上 `delete` 与 `diff`（对账/回滚）。

---

## 2. `read` 读文件

### 2.1 输入 / 输出

```ts
// 输入
{ path: string, offset?: number, limit?: number }
// 输出
{ content: string, truncated: boolean, totalLines: number }
```

- `offset`/`limit` 按行分片，防止一次读入超大文件撑爆 context。
- **图片**：读到图片路径时，不返回原始字节，而是作为 **image 附件**回传模型（多模态模型可看图）。
- 读目录？报错（指导用 `ls` / `glob`）。

### 2.2 边界

- 超长文件：调用方（LLM）应明确 offset/limit；无 limit 时给 truncation 警告并截断（50KB 级）。
- 二进制 / 非 UTF-8：检测到后不裸读，返回提示（"二进制文件，改用其他方式"），避免垃圾字节污染 context。
- 路径规范化：拒绝 `..` 逃逸攻击（见 §7 路径保护）。

---

## 3. `grep` 搜索文件内容

> 对应需求 FR-3.6。

### 3.1 实现分层

1. **优先 ripgrep**（`rg`）：快、默认忽略 `.gitignore`、支持 glob/正则/上下文。
2. **fallback 正则**：无 rg 时用内置正则引擎，需自行处理 `.gitignore` 与递归。

### 3.2 输入 / 输出

```ts
{ pattern: string, path?: string, glob?: string, caseSensitive?: boolean, maxResults?: number }
→ { matches: [{ file, line, text, lineNumber }], total }
```

- 返回**命中行 + 行号 + 上下文**（给模型定位用），而非整文件。
- `maxResults` 截断，防止海量命中撑爆 context（这是 sub-agent 场景的典型污染源）。

### 3.3 边界

- 空 pattern / 正则错误 → 明确报错，不静默。
- 大目录海量命中 → 截断并告知 total，让模型决定是否收窄 pattern。

---

## 4. `patch` 补丁文件

> 对应需求 FR-3.3。这是"改"的核心工具，也是 dscode 与 Codex `apply_patch` 对齐的落点。

### 4.1 设计要点

- **多 disjoint edit**：一次 patch 可含多个独立的 oldText→newText 替换，避免模型"一次只改一处"的低效。
- **oldText 全文唯一匹配**：每个 oldText 必须在文件中恰好出现一次，否则**报错**（防模型改错位置）。
- **重叠检测**：多个 edit 的区间互相重叠 → 报错，防"前一个替换把后一个的 oldText 改没了"。
- 支持 `path` / `oldText` / `newText` / `replace_all`（显式声明才允许全局替换）。

### 4.2 为什么不用"整文件覆盖"

整文件覆盖（rewrite）的问题见 §1.1。patch 的**精确替换**让：
- diff 最小 → 审计清晰、回滚成本低。
- 不破坏文件其余部分 → 模型不会"顺手改掉无关行"。
- cache 打碎少 → provider 层 prompt cache 可复用未变前缀。

### 4.3 边界

- oldText 未命中 / 命中多次 → 报错并提示，不猜。
- 待改的路径不存在 → 报错（改前先 `read` 确认）。
- 性能：大文件（>10MB）建议先定位再 patch，避免全文件扫描。

---

## 5. `delete` 删除文件

> 需求 FR-3 未单列，但架构安全模型要求显式覆盖。

### 5.1 输入 / 输出

```ts
{ path: string } → { deleted: boolean, path: string }
```

- **只删指定文件**，不连带删父目录、不递归删目录（递归删目录需显式 `recursive: true` 且过权限）。
- 删除前先确认存在；不存在 → 返回 not-found 而不是报错。

### 5.2 安全边界

- 危险路径受权限 deny 保护（`.env`、`secrets/`、`node_modules/` 等，见架构文档 §6）：即便模型想删也被网关 block。
- 删除是**不可逆**的 → 必须走权限网关的 ask 模式（默认），且有 diff/对账兜底（见下）。

---

## 6. `diff` 文件变更对账

### 6.1 职责

- 呈现"改前 vs 改后"的统一 diff（unified diff）。
- 是 patch / delete 执行后的**审计与回滚依据**：用户在 execute 阶段看到"到底改了什么"。
- 配合 plan-and-execute 的 expectedFiles 对账（见 原理-plan-and-execute.md §7）：改动超出计划 → 暂停询问。

### 6.2 输入 / 输出

```ts
{ path: string } 或 { paths: string[] } → { diff, stat: { added, removed } }
```

- 单文件或目录级批量 diff。
- 与 git 不绑定：dscode 自己记录"变更前快照"，diff 基于内存/快照，不强制用户仓库已 `git init`。

### 6.3 与回滚的关系

- execute 阶段 dscode 记录"plan 起点 → 当前"的 diff 快照（见 原理-plan-and-execute.md §9.3）。
- 用户可基于 diff 做 `git checkout` 回滚，或让 dscode 用快照还原。

---

## 7. 跨工具横切：路径保护与权限

所有文件工具共享同一套路径安全层：

- **路径规范化**：解析 `..`、符号链接，拒绝逃逸出 cwd 的路径。
- **权限网关**：每个工具调用先过 allow/deny/ask 规则（`glob` 模式匹配），write/edit/bash 写操作、delete 必须过权限。
- **deny 覆盖**：`.env`、`secrets/`、`.git/` 等敏感路径默认 deny（架构文档 §6）。
- plan 模式：`read`/`grep` 允许，`patch`/`delete` 被权限 deny（只读规划）。

---

## 8. 典型工作流（串起来）

```
LLM:"找到 auth.ts 里过期的 token 校验并修掉"
  grep "token" auth.ts            → 定位行号
  read auth.ts offset:.. limit:..  → 看上下文
  patch {oldText:"...", newText:"..."} → 精确补丁
  diff auth.ts                     → 对账，确认只改了该改的
  (plan 模式) 权限 deny patch/delete → 只产出计划
```

---

## 9. 抓手与判据

| 抓手 | 判据 |
|------|------|
| patch 精确 | oldText 唯一匹配才替换；未命中/重复命中必报错 ≥ 99% |
| 无整文件覆盖 | patch 很少触发 rewrite；diff 平均行数 ≤ 目标改动行数 + 20% |
| read 不爆 context | 超长文件被 offset/limit / truncation 约束，无单次 >50KB 进 context |
| delete 安全 | 危险路径（.env 等）删除被 100% block；非显式 recursive 不删目录 |
| diff 可审计 | 每次 patch/delete 后必有 diff 快照，可对账、可回滚 |

---

## 10. 反模式（明确不做）

- ❌ "一个 `file_edit` 全包"——不可控、不可审计。
- ❌ "patch 里 oldText 模糊匹配就替换"——必须全文唯一，否则报错。
- ❌ "delete 递归删目录"——默认禁止，需显式 recursive + 权限。
- ❌ "delete 直接删不确认"——不可逆操作必须走 ask 权限。
- ❌ "改完不给 diff"——每一次改动都要可对账。

---

## 11. 与其他原理文档的衔接

- 文件工具是 **Agent Loop 的执行原语**，被 loop 的 tool_call 调度。详见 原理-agentloop.md。
- patch/delete 触发"改前快照 + diff"，是 **plan-and-execute 的 expectedFiles 对账与回滚**的数据源。详见 原理-plan-and-execute.md §7/§9。
- 文件工具读入的内容、grep 的海量命中，都可能撑大 context → 触发 compact。详见 原理-compact.md。
- 权限网关统一拦截所有文件工具，见 架构文档.md §6。