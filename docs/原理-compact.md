# 原理：上下文压缩（Compaction）

> 状态：v0.1（设计期，落地前以本文为准绳）
> 配套：架构文档.md §4.2.10 / 需求文档 FR-12 / 索引文档.md
> 本文回答："长对话怎么不爆 context"——何时切、在哪切、摘要什么、怎么重建视图。

---

## 0. TL;DR

**LLM 的 context window 是有限资源；dscode 的 session 会无限增长。两者的鸿沟必须靠"压缩"填。**

dscode 用一种叫 **Compaction（压缩）** 的机制：
1. **Token 计数**：实时跟踪当前 context 的 token 用量。
2. **触发判定**：当 context token > contextWindow - reserveTokens，自动触发。
3. **cut point 选取**：从最新消息倒着走，累计 token ≥ keepRecentTokens 处的合法点。
4. **摘要生成**：把"被切掉的旧段"序列化成文本，喂一次 LLM 生成结构化摘要。
5. **写 compaction entry**：摘要作为一个新 entry 入 session。
6. **重建视图**：之后每次构建 LLM 上下文时，**用摘要替代被切段**——LLM 看不到原消息，看到的是摘要。

附产品：**Branch Summary（分支摘要）**——`/tree` 切分支时对"被放弃的分支"做摘要，防止切回来时丢上下文。

附产品：**Context View（context 视图）**——`buildContextEntries()`：把"原 session"折叠成"LLM 看到的消息"，是 compact 与 branch summary 的统一消费点。

---

## 1. 为什么需要压缩

### 1.1 问题

- DeepSeek-V3 contextWindow = 64K/128K，DeepSeek-R1 = 64K。即使 128K 也是有限的。
- 一轮工具往返可能塞进 1-5K token（bash 输出、读全文文件、grep 结果）。
- 多轮调试、错误恢复、长任务（"重构整个模块"）轻松超 50K。
- 超 contextWindow 直接报错；将近年限前还可能随 API 价格飙升（cache miss）。

### 1.2 解法：摘要替代

业界共识（Claude Code / pi / Cursor 后台 / OpenCode）：**用一次 LLM 调用把"已远离当前焦点"的消息总结成结构化摘要，替代原文。** 原理是：摘要的 token 数远小于原文（典型 5-20x 压缩），同时保留关键事实（目标、决策、文件操作、待办）。

### 1.3 何时压缩 vs 何时遗忘

压缩不是删除——摘要仍要**保留关键事实**供后续决策使用。dscode 选 **结构化摘要**（目标/约束/进度/决策/下一步/关键文件），不是开放式总结。

---

## 2. Token 计数（前置基础设施）

> 没有准确的 token 计数，所有压缩都是瞎触发。

### 2.1 输入侧

LLM 请求里的"token 用量"由 `usage.prompt_tokens` 给出（provider 返回）。**这是最准确的数字**，dscode 把它记录到 session。

### 2.2 输出侧 + 累计

每轮 turn 把 `usage.{prompt_tokens, completion_tokens, cache_read_input_tokens, cache_creation_input_tokens}` 累加到 session 统计。

### 2.3 估算（fallback）

模型不在场时（pure local、checkpoint 加载），用启发式估算：

```ts
function estimateTokens(text: string): number {
  // 中文：~1.6 token/字（含标点）；英文：~0.25 token/char（BPE 经验）
  // 简化：chars * 0.5 + cjkChars * 1.2 ≈ ~80% 准确
  ...
}
```

### 2.4 prompt cache 感知

DeepSeek context caching 的 cache hit（`cache_read_input_tokens`）按 0.1x 价格计费，且**重复前缀是免费/廉价的**。这影响 compact 策略：
- **不要频繁切前缀**——会破 cache，得不偿失。
- cut point 要稳定（同一位置的多次 compact 都保留同一 keep boundary），让 cache 续命。
- 这就是 §4 的"用 previous compaction 的 firstKeptEntryId 作起点"的设计。

### 2.5 计数位置

- 每次 LLM 调用后写 `usage` 到对应 assistant message。
- 每次 `buildContextEntries()` 后汇总当前"将送 LLM 的"token 数（含摘要、system prompt、tools schema）。
- 用"当前"token vs `contextWindow - reserveTokens` 判触发（§3）。

---

## 3. 触发条件

```
contextTokens > contextWindow - reserveTokens  →  自动压缩
/compact [instructions]                        →  手动压缩
overflow（provider 返回 "context_length_exceeded"）→  overflow 压缩 + 重试
```

| 配置 | 默认 | 说明 |
|------|------|------|
| `compaction.enabled` | `true` | 总开关 |
| `reserveTokens` | `16384` | 给 LLM 响应留的预算（DeepSeek-V3 输出 ≥8K，reasoning 更大，留 16K 充裕） |
| `keepRecentTokens` | `20000` | "近期不切"的预算——保留最近 ~20K token 原文 |

设计原则：
- 自动压缩触发**不打断当前 turn**——只在 turn 间隙（下一次 LLM 调用前）触发。
- 若用户立即提交新一轮 → 阻塞到压缩完成才跑。
- overflow 触发特殊：当前 turn 中断 → 紧急压缩 → 退回到被压缩的 turn 重新发起（`willRetry: true`）。

---

## 4. Cut Point 选取（核心算法）

### 4.1 目标

找一个 entry 索引 X，从 X 开始往前的消息全部"摘要化"，X 及之后"保留原文"。X 叫 `firstKeptEntryId`。

### 4.2 规则

```
从 session 末尾向前累计 token：
  accumulator += tokens(entry)
  直到 accumulator >= keepRecentTokens
取最近的一个合法 cut point（见 4.3）作为 X
若 X 之前的所有 entry token 之和 < keepRecentTokens（极端短会话），不压缩
```

### 4.3 合法 cut point（哪些 entry 边界可以切）

- ✅ User 消息
- ✅ Assistant 消息
- ✅ BashExecution（bash 工具结果消息，作为 assistant 的附属信息）
- ✅ Custom 消息 / BranchSummary
- ❌ **绝不能** 切在 tool result 单独一条消息上——它必须跟所属 assistant 消息（带 tool_call）同侧
- ❌ **绝不能** 切在消息**内部**（半个 assistant 流中间）——必须整 entry

### 4.4 split turn（特例）

如果一个 turn 自身就超过 `keepRecentTokens`（典型：模型一次性返回巨大内容 + 多个 bash tool_call + 海量 tool result），cut point 会落到 turn 中间：

```
entry:  hdr usr  ass tool ass tool tool ass tool
                            ↑ X（cut 在第 7 条 ass 上）
        ├─ turnPrefix 留待摘要 ─┤├ kept ─┤
```

这种情况叫 split turn，`firstKeptEntryId` 落在 turn 中间，**不合法**——会导致 model 看不到工具结果来源的 assistant 消息。处理：
- 把 turn 的前半（usr → ass → tool → ... → X 之前的 ass）一起送摘要，**生成两份摘要**：
  - `history summary`：X 之前的所有完整 turn 的摘要。
  - `turn prefix summary`：当前 turn 在 X 之前那段（prefix）。
- 合并两份摘要写 compaction entry。
- X 之后到当前 turn 末尾保留原文。

### 4.5 迭代 compaction（多次压缩时）

session 已有 compaction entry 时，下次压缩从 **上一次 compaction 的 firstKeptEntryId** 开始重算"待压缩段"——不是从 compaction entry 开始。这样：
- 之前保留但现已不在焦点的旧消息会被并入下一次的摘要。
- **保住 cache**：每次的 firstKeptEntryId 之前的内容是稳定的"原文摘要块"，前缀对 cache 友好。

```
首次：  摘要 [0..3]   保留 [4..N]
二次：  摘要 [4..7]   保留 [8..N]
新 compaction entry 描述 [0..3] + [4..7] 的合并摘要
LLM 看到的：[摘要(0..7)] + [8..N]
```

---

## 5. 摘要生成（LLM 调用）

### 5.1 序列化：消息→文本

```ts
import { convertToLlm, serializeConversation } from "@dscode/core";

const text = serializeConversation(convertToLlm(preparation.messagesToSummarize));
// 输出：
// [User]: ...
// [Assistant thinking]: ...
// [Assistant]: ...
// [Assistant tool calls]: read(path="..."); bash(command="...")
// [Tool result]: ...
```

要点：
- 必须**显式标注说话人**——否则模型会以为"我在接着对话"，续写出 prose。
- **tool result 截断到 2000 字符**——超出标 `<truncated:12345 chars>`。bash/read 的输出通常是"占 context 的元凶"，不截就回不到压缩目的。
- thinking/reasoning 选择性保留——reasoner 模型 reasoning 量极大，不进摘要（仅留 final content 与 tool call）。

### 5.2 摘要 prompt（结构化强制）

system：你是会话摘要器，按下面格式输出：
```
## Goal          — 用户目标（一句话）
## Constraints   — 约束与偏好
## Progress      — Done / In Progress / Blocked
## Key Decisions — 关键决策及理由
## Next Steps    — 下一步（编号）
## Critical Context — 续作必须知道的（API、文件、配置）

<read-files>path1</read-files>
<modified-files>path2</modified-files>
```

强制结构化原因：摘要被后续 turn 模型消费，结构稳定 → 可被规划工具扫（"下一步"列表 → task tool）；文件清单可与工具结果交叉验证；可被测试断言。

### 5.3 关键参数

- **fresh routing session id**：摘要调用不走主 session 的 id，避免与用户会话的 cache key 互踩。
- **disable cache write**：摘要是一次性 prompt，下次不会复用，禁 cache write 省回写成本（DeepSeek 区分 cache write/read 价格）。
- **temperature**：0 或近 0，要求忠实而非创造。
- **model**：默认沿用主 model（一致上下文）。可配 `compaction.model` 改用更便宜/更快的小模型——但要承担"摘要质量下降"风险。dscode 默认沿用。

### 5.4 文件操作累计

摘要 prompt 输入里附带"本次会话累计 read/modified 文件"列表（从 tool call + tool result 提取 + 上一次 compaction 的 details 累计）。这是**设计意图**：让后续 turn 的"接下来改哪个文件"决策有据。

### 5.5 摘要错误处理

- LLM 摘要失败（网络、限流） → 重试 2 次；仍失败则回退**机械截断**：丢弃被切段的旧消息，仅保留最近 N 条原文 + 警告标注。不能让会话卡死。
- 摘要长度异常（>原长度）→ 触发二次摘要请求："上面你的摘要太长，请再压缩到 ≤X token"。

---

## 6. Compaction Entry（写回 session）

```ts
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string;          // 上一条 entry 的 id（保持树状）
  timestamp: number;
  summary: string;           // §5 结构化摘要
  firstKeptEntryId: string;  // §4 cut point
  tokensBefore: number;      // 压缩前 token（重算，含 system + tools + 当前 messages）
  usage?: Usage;             // 摘要 LLM 调用的 usage，计入 session 成本
  fromHook?: boolean;        // 由扩展提供（自定义摘要）
  details?: T;               // 默认 {readFiles, modifiedFiles}；扩展可自定义
}
```

**注意：tokensBefore 必须是**压缩前实际重算的**——不是估算**。否则后续 compact 触发器会失准。

---

## 7. Context View（消费点）

> 这是 compact 的下游：模型实际"看到"的消息从这里出。

### 7.1 buildContextEntries()

```ts
function buildContextEntries(branch: Entry[]): LlmMessage[] {
  const result: LlmMessage[] = [];
  let cutAt: string | null = null;
  let compactionSummary: string | null = null;

  // 从后向前找最近的 compaction（或 branch summary）
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      compactionSummary = branch[i].summary;
      cutAt = branch[i].firstKeptEntryId;
      break;
    }
  }

  // 先放摘要作为 "user" 角色引导（带 system 说明这是历史摘要）
  if (compactionSummary && cutAt) {
    result.push({
      role: "user",
      content: `[Earlier conversation summary — references up to entry ${cutAt}]\n\n${compactionSummary}`,
    });
  }

  // 再放 cutAt 之后的真实消息
  const cutIndex = branch.findIndex(e => e.id === cutAt);
  const kept = cutIndex >= 0 ? branch.slice(cutIndex) : branch;
  for (const e of kept) result.push(...toLlmMessages(e));

  return result;
}
```

要点：
- 摘要作为 **"user" 角色消息**插入（不是 system）——保留模型对"这是上一段对话的总结"的感知。
- cutAt 之后的原文保留完整 tool_call/tool_result 对（不能丢 tool result 让对应 call 悬空）。
- 多个 compaction entry 取最近的第一个（链式）。

### 7.2 branch summary 的应用

`/tree` 跳到新分支时若选了"对旧分支摘要"，session 在切换点插入 `BranchSummaryEntry`：

```ts
interface BranchSummaryEntry {
  type: "branch_summary";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  fromId: string;       // 切换前的 leaf id
  usage?: Usage;
  details?: T;
}
```

`buildContextEntries` 把 branch summary 也作为 user 消息注入（"这是被放弃分支的摘要，你在新分支上工作"）。

---

## 8. 扩展可自定义（重要）

### 8.1 自定义摘要策略

```ts
dscode.on("session_before_compact", async (event, ctx) => {
  // event.preparation = {messagesToSummarize, turnPrefixMessages, previousSummary,
  //                       fileOps, tokensBefore, firstKeptEntryId, settings}
  // event.branchEntries = 整条当前分支
  // event.reason = "manual" | "threshold" | "overflow"
  // event.willRetry = overflow 时是否重试当前 turn

  if (event.preparation.messagesToSummarize.length > 50) {
    // 大段：拆成两批摘要合并
    const half = Math.floor(event.preparation.messagesToSummarize.length / 2);
    const s1 = await summarizeWith(event.preparation.messagesToSummarize.slice(0, half));
    const s2 = await summarizeWith(event.preparation.messagesToSummarize.slice(half));
    return {
      compaction: {
        summary: s1 + "\n\n---\n\n" + s2,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        usage: combinedUsage,
        details: { readFiles: [...], modifiedFiles: [...] },
      },
    };
  }
  // 默认继续
  return { cancel: false };
});
```

### 8.2 完全替换模型

扩展可接管"用什么模型、什么 prompt 摘要"——满足"用小模型摘要省成本"或"用更专业 prompt 提高摘要质量"等需求。

### 8.3 禁止压缩

```ts
dscode.on("session_before_compact", async (e, ctx) => {
  if (someCondition) return { cancel: true };
});
```

用于"此任务不能丢任何细节"场景（极少见）。

---

## 9. 手动压缩与命令

- `/compact`：手动触发，event.reason = "manual"。
- `/compact 重点保留测试相关上下文`：customInstructions 字段传给扩展，扩展可拼到 system prompt 引导摘要。
- `/tree` 时是否要 branch summary：弹三选一对话框（不摘要 / 默认摘要 / 自定义焦点）。

---

## 10. 边界与失效模式

### 10.1 何时压缩无效（压缩后还是超）

- 摘要本身就超 contextWindow（极少见，但超大 read 文件极端情况）→ 二次摘要请求强制再压。
- 模型本身在压缩后 turn 又调用大工具 → 下一次 turn 仍可能溢出 → overflow 路径。

### 10.2 摘要丢关键事实

- 模型可能"丢"未明示的隐式约定（"用户偏好变量命名带前缀"）。解法：DSCODE.md 把约定显式化（"我们的命名约定…"），即便摘要丢了，DSCODE.md 仍在 system prompt。
- 摘要错记文件操作：details 里 `readFiles/modifiedFiles` 二次校验；测试时单测覆盖。

### 10.3 compaction 与 cache 冲突

- 频繁 compact 切碎 cache prefix → 算下来可能更贵。dscode 用"稳定 firstKeptEntryId"减少切碎。
- 用户可关 `compaction.enabled`，但要承担 overflow 风险。

### 10.4 并发 compaction

session 文件是单写者（AgentSession）。compaction 在 idle / turn 间隙触发，不并发。但要小心：手动 `/compact` 与自动触发可能撞——dscode 用"已在 compacting"标志位互斥。

---

## 11. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 自动触发准确 | 触发时 `tokensBefore` 与 contextWindow - reserveTokens 误差 ≤ 5% |
| cut point 合规 | 永远不切在 tool result 单独条；split turn 必须双摘要合并 |
| 关键事实保留 | 压后问 3 个"压缩前问过的事实"，≥ 2 答对（评测套件） |
| 文件操作累计 | session 末尾的 read/modified 列表 ≥ 实际产生量（不丢） |
| 摘要稳定 | 同一消息段两次摘要的"Goal/Next Steps"字段差异 ≤ 10% |
| 成本节省 | 压后 5 轮 turn 平均 input token 比压前下降 ≥ 50% |
| cache 友好 | 连续 3 次压保留同一 firstKeptEntryId（不抖动） |

---

## 12. 反模式（明确不做）

- ❌ "每轮都压"——成本与 cache 损失远超收益。
- ❌ "压到只剩一句话"——丢太多，下游 turn 决策失据。
- ❌ "用模型输出当新 system prompt"——污染 system prompt 来源。
- ❌ "把摘要塞进 system prompt"——system prompt 应稳定，摘要属于 user 消息。
- ❌ "压完不写 compaction entry，直接改 session"——破坏可恢复性，未来 audit/调试靠 entry。

---

## 13. 与其他原理文档的衔接

- compact 是 Agent Loop 的下游：循环不停 → 消息堆 → 必须 compact。详见 原理-agentloop.md。
- compact 与 plan-and-execute.md 的关系：plan 模式天然抑制"长自由发挥"——减少 compact 触发频率；execute 自愈回路的"失败历史"也可能成为 compact 对象。
- compact 写回 session 树（索引文档 §依赖图）——branch summary 与 `/tree` 跳转联动。
