# 原理：Session（会话持久化）

> 状态：v0.1（设计期，v0.2 落地，落地前以本文为准绳）
> 配套：架构文档.md §4.2.3 / 需求文档 FR-5 / 索引文档.md
> 本文回答：对话怎么存、怎么恢复、怎么分叉——JSONL 树状 session 的写入、resume/fork/branch、以及 buildContextEntries 如何把"历史"变成"LLM 看到的上下文"。

---

## 0. TL;DR

**Session 是 dscode 的"记忆"：每次对话的每条消息都落成一个 JSONL entry，构成一棵可导航的树。用户关掉终端再打开，`dscode -c` 就能接着干；`/tree` 能在历史节点分叉出不同方案。**

1. **存储**：`~/.dscode/sessions/<cwd-hash>/<session-id>.jsonl`，每行一条 entry。
2. **entry 结构**：`{id, parentId, type, role, content, timestamp, ...}`，靠 parentId 连成树。
3. **类型**：user / assistant / toolResult / compaction / branchSummary / modelChange / label / extension。
4. **树状导航**：`/tree` 跳节点、`/fork` 生成新分叉、`/clone` 复制当前分支、分支摘要。
5. **消费点**：`buildContextEntries()` 把"当前激活分支 + compaction 应用"折叠成 LLM 实际看到的消息序列。

> 完全对标 pi 的 session 格式——这是经过 pi 验证的最优设计（架构文档 §4.2.3）。

---

## 1. 为什么需要 session

### 1.1 问题

- 对话是一次性的：关终端就没了，多轮重构（"昨天那个会话继续"）无法续接。
- Agent 一轮要读很多文件、跑很多命令，这些**过程**（不只是结论）是审计与调试的素材。
- 用户想试两种方案（"用 A 还是 B"），需要**分叉对比**，而不是重新开一个啥都不记得的会话。

### 1.2 解法：JSONL 树

JSONL（每行一个 JSON 对象）+ 树（parentId 链接）：
- **JSONL**：追加写、可流式读、每行可独立 `JSON.parse` 校验（SC-2.1 直接用它验证）。
- **树**：不止线性回放，还能跳回任意历史节点从那里分叉——这是"分支探索"（US-5）的基础。

---

## 2. 存储布局

```
~/.dscode/sessions/
  <cwd-hash>/          # 按工作目录归类（cwd 的 hash）
    <session-id>.jsonl # 一场会话一个文件
```

- `<cwd-hash>`：同一仓库的会话聚在一起，`-r` 浏览时按仓库组织。
- 追加写：每轮 turn 结束把新 entry append 到文件，**不重写全文**（崩溃最多丢最后半行）。

### 2.1 entry 结构

```jsonc
{ "id": "e-001", "parentId": null, "type": "user",
  "role": "user", "content": "重构 auth 模块", "timestamp": 1723000000000 }
{ "id": "e-002", "parentId": "e-001", "type": "assistant",
  "role": "assistant", "content": "...", "usage": { "prompt_tokens": 1200 } }
{ "id": "e-003", "parentId": "e-002", "type": "toolResult",
  "role": "tool", "content": "<bash 输出>", "toolCallId": "call_1" }
```

### 2.2 entry 类型

| type | 含义 |
|------|------|
| `user` / `assistant` | 对话消息 |
| `toolResult` | 工具执行结果（含 toolCallId） |
| `compaction` | 压缩摘要（见 原理-compact.md） |
| `branchSummary` | 被放弃分支的摘要 |
| `modelChange` | `/model` 切换记录（审计谁何时换了模型） |
| `label` | `/name` 命名标记 |
| `extension` | 扩展写入的自定义 entry |

---

## 3. 三条路径：resume / fork / clone

### 3.1 resume（继续）

- `dscode -c`：继续当前 cwd 最近一个会话。
- `dscode -r`：浏览会话列表，选一个恢复。
- 恢复 = 读 JSONL → 重建消息树 → `buildContextEntries()` 出上下文 → 继续 Agent Loop。

### 3.2 fork（分叉）

- `/fork`：选中历史节点，**生成一个新 session 文件**，从该节点开始新分支。
- 旧文件**不变**（SC-2.4：fork 后旧文件原样保留）——这是"试另一种方案"的代价边界。

### 3.3 clone（复制分支）

- `/clone`：复制当前分支到新 session，原 session 不动。
- 与 fork 的区别：clone 复制"当前整条路径"，fork 从"选中节点"起步。

### 3.4 分支摘要（branchSummary）

- `/tree` 切走一个分支时，对"被放弃的分支"做摘要（branchSummary entry）。
- 切回来时靠摘要恢复关键事实，不丢上下文——见 原理-compact.md（Branch Summary 是 compact 的附产品）。

---

## 4. buildContextEntries()：session → LLM 上下文

这是 session 与 Agent Loop 的**唯一接口**：

- 输入：整棵 session 树 + 当前激活分支 + compaction 状态。
- 输出：LLM 实际看到的消息序列（`{role, content}` 数组）。
- 规则：
  - 只沿**当前激活分支**走（不在分支上的消息不进上下文）。
  - 遇 `compaction` entry → 用摘要替代被切段（见 原理-compact.md §0）。
  - 遇 `branchSummary` → 折叠为一行摘要文本。
  - `modelChange` / `label` / `extension` 按需注入或跳过。

**关键**：session 是"完整历史"，buildContextEntries 是"LLM 视角"。两者分离，才能既保留可审计的全文，又不让 LLM 被历史淹没。

---

## 5. 生命周期与一致性

- **单写者**：AgentSession 是唯一写者，避免多进程同时写同一 jsonl。
- **自动保存**：每轮 turn 后落盘（SC-2.1）；不必每条消息都 fsync（性能预算，见 NFR）。
- **损坏恢复**：读到非法行 → 跳过并提示（不整文件崩溃）。
- **切换 teardown**：`/new`、切会话时做 teardown + rebuild（架构文档 §4.2.1 AgentSession Runtime）。

---

## 6. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 自动保存 | 一轮对话后 sessions 下出现 .jsonl，每行 `JSON.parse` 通过（SC-2.1） |
| resume 可靠 | 上轮说"密码是 s3cr3t"，`-c` 后问"密码是什么"答对（SC-2.2） |
| 树状正确 | `/tree` 跳节点后 parentId 指向选中节点（SC-2.3） |
| fork 不破坏 | `/fork` 后新文件生成、旧文件不变（SC-2.4） |
| 上下文重建 | buildContextEntries 只含激活分支 + compaction 应用，分支外消息不进 |
| 崩溃弹性 | 写一半崩溃 → 重开能读到已落盘 entry，半行丢弃不崩 |

---

## 7. 反模式（明确不做）

- ❌ "每轮重写整个 jsonl"——必须追加写，防 O(n²) 与崩溃丢全文。
- ❌ "session 全量进上下文"——必须经 buildContextEntries 折叠。
- ❌ "fork 改旧文件"——旧文件必须原样保留。
- ❌ "多写者并发写同一 jsonl"——单写者。
- ❌ "扩展直接改 session 文件"——必须走 entry 类型 + 事件，保可恢复性。

---

## 8. 与其他原理文档的衔接

- buildContextEntries 是 **Agent Loop** 的上下文入口。详见 原理-agentloop.md。
- `compaction` / `branchSummary` entry 由 **compact 机制**写入并消费。详见 原理-compact.md。
- session 是 **plan-and-execute** 的 plan/checkpoint 落点（execute 每步写 step 状态）。详见 原理-plan-and-execute.md §9.4。
- `/export` 导出 markdown/HTML 基于 session 全文（FR-5.5）。