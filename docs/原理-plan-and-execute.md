# 原理：计划与执行（Plan-and-Execute）

> 状态：v0.1（设计期，落地前以本文为准绳）
> 配套：架构文档.md §4.2.9 / 需求文档 FR-9 FR-10 / 索引文档.md
> 本文回答："先想清楚再动手"——怎么把"自由发挥的 agent"约束成"先出 plan、确认后执行、出错自愈"的闭环。

---

## 0. TL;DR

**Agent Loop 是"自由发挥"——LLM 想说啥说啥、想调啥调啥。在真实工程里这容易跑偏、忘上下文、改坏不回滚。dscode 用 Plan-and-Execute 模式给 loop 加约束：**

1. **意图识别**：先把用户输入分到"命令 / 提问 / 任务 / 闲聊"四类之一。
2. **任务分解**：任务类进 plan 阶段——模型先产"步骤清单 + 风险点 + 影响范围"，不调任何写工具。
3. **用户确认**：plan 产物呈现给用户；接受后才进 execute。
4. **执行与自愈**：execute 阶段跑 loop，但每步有"对照计划"的校验 + 出错自愈 + 进度可见。
5. **偏离处理**：发现实际路径偏离原 plan（改了不该改的文件、做了未计划的动作）→ 暂停，问用户。
6. **完成验收**：所有 plan step done 后，整体验收报告。

围绕这条主线，dscode 还挂四层：
- **Slash 命令路由**（§4）：意图的另一入口。
- **信息检索**（§5）：web search / grep / read 怎么纳入 plan/execute 视图。
- **子 agent**（§6）：sub-agent 隔离执行污染主 loop。
- **错误自愈**（§9）：错误分级、回滚、重试、求助。

---

## 1. 为什么需要计划与执行分离

### 1.1 问题

纯 Agent Loop 在小任务上"想-做-说"一气呵成，体感流畅。但面对复杂任务暴露：
- **忘目标**：跑到一半改了无关文件，模型把"做 A"做成"做 B"。
- **过度发挥**：用户说"修个 bug"，模型顺手重构了整个模块。
- **不可见**：用户只能事后看 session 文本，事前看不到模型打算干啥。
- **不可中断**：跑到 80% 才发现走错了，回滚成本巨大。
- **不可审计**：CI / 团队场景需要"它计划做什么"作为审计证据。

### 1.2 解法：两阶段

Kiro（spec-first）、Claude Code（Plan mode）、Aider（Architect vs Editor）、Cursor Composer 的"vibe-mode vs precise-mode"——共识答案：
1. **Plan 阶段**：只读、可观察、可拒绝、可修改。
2. **Execute 阶段**：按计划执行、状态可见、出错可中断/回滚。

dscode 把这两个阶段做成 **mode**（`/plan` 切换），不强制每次都走——但**默认进入 plan**（用 `mode: "agent" | "plan" | "full-auto"` 三选一控制）。

---

## 2. 工作流总图

```
                 用户输入
                    │
                    ▼
            ┌───────────────┐
            │   意图识别     │  ← §4 slash 命令路由也是这里
            └───────┬───────┘
                    │
        ┌───────────┼────────────┬──────────────┐
        ▼           ▼            ▼              ▼
     命令类       提问类       闲聊类         任务类
   (slash/快捷)  (直接回)    (礼貌回)         │
                                  │           ▼
                                  │    ┌────────────────┐
                                  │    │  Plan 阶段      │
                                  │    │  (只读, 无写)   │
                                  │    └───────┬────────┘
                                  │            │
                                  │            ▼
                                  │    ┌────────────────┐
                                  │    │  计划呈现 + 用户 │
                                  │    │  接受 / 修改 / 拒│
                                  │    └───────┬────────┘
                                  │            │ accept
                                  │            ▼
                                  │    ┌────────────────┐
                                  │    │ Execute 阶段    │
                                  │    │ (loop + 校验)   │
                                  │    └───────┬────────┘
                                  │            │
                                  │            ▼
                                  │    ┌────────────────┐
                                  │    │ 完成验收 + 报告 │
                                  │    └────────────────┘
                                  ▼
                              done
```

---

## 3. 模式（mode）配置

### 3.1 三种模式

| 模式 | Plan | Execute | 用户交互密度 |
|------|------|---------|-------------|
| `agent` | 一次性产出，**自动接受**，直接 execute | 常规权限 | 中 |
| `plan`（默认） | 显式呈现，**必须用户接受**才 execute | 常规权限 | 高 |
| `full-auto` | 跳过 | 全自动权限 | 低 |

### 3.2 启动覆盖

```bash
dscode --mode agent           # 默认 plan 改 agent
dscode --mode plan            # 显式
dscode --mode full-auto       # CI/无头场景
dscode -p "..."               # print 模式隐式 full-auto
```

会话中可用 `/mode <agent|plan|full-auto>` 切换。

---

## 4. 意图识别（Intent Classification）

> 用户输入字符串先经过意图识别路由，分流到 ① 命令/快捷 ② 直接回答 ③ 任务（→ plan 入口）④ 闲聊。

### 4.1 路由表

```
if (input.startsWith("/"))         → 命令（§4.2）
if (input.startsWith("!"))         → 用户 bash（注入上下文）
if (input.startsWith("?quick ") || startsWith("@")) → 工具型输入（transform 后进 loop）
if (looksLikeQuestion(...))        → 提问类（直接 LLM 答，不进 plan）
if (looksLikeGreeting(...))        → 闲聊（短回，不调工具）
else                              → 任务类（→ plan 入口）
```

### 4.2 Slash 命令路由（与意图识别同源）

所有 `/` 开头优先匹配：

| 类别 | 命令 |
|------|------|
| 模式 | `/mode <agent\|plan\|full-auto>`、`/plan`、`/accept-plan`、`/reject-plan` |
| 模型 | `/model`、`/scoped-models`、`/thinking` |
| Session | `/new`、`/resume`、`/tree`、`/fork`、`/clone`、`/name` |
| 上下文 | `/compact`、`/clear`、`/reload`、`/share`、`/export` |
| 工具 | `/cost`、`/context`、`/exit`、`/help`、`/skill:<name>`、`/template:<name>` |
| 用户自定义 | 扩展 `registerCommand()` 注册的命令（按加载顺序匹配） |

匹配顺序：
1. **扩展命令**（最早注册的最先匹配——让扩展可"拦截"内置）。
2. 内置命令。
3. 未命中 → 视为普通输入，进意图识别流程。

### 4.3 意图识别实现

启发式 + 小模型兜底：
- 启发式规则覆盖 80%+ 用例（slash、`!`、`?quick`、关键词"怎么""为什么"→ 提问）。
- 兜底用极小本地分类模型（可选）或主 LLM 单 token 分类（成本 < 1%）。
- **绝不让意图识别阻塞主路径**——失败回退"任务类"（最安全的默认）。

### 4.4 与 plan 的耦合

任务类直接进 §5 plan；其他类不调写工具也不进 plan。这就是 "plan 不是每次都走，但任务必走 plan" 的设计。

---

## 5. 信息检索作为执行

### 5.1 web search 的双重身份

- **Plan 阶段**：模型读 readme / changelog / 文档做计划——webfetch 是关键工具。
- **Execute 阶段**：模型查 API 文档、查 bug tracker——web search/fetch 同样是工具。
- 两者调用方式一致；区别在于 §7 的"计划 vs 实际"校验——plan 阶段调 read 不计偏离，execute 阶段调 read 也计。

### 5.2 web search 实现路径

dscode v1 的 web search 走两条：
1. **本地 grep/glob/read**：模型自主用工具搜仓库（快、零成本、机密）。
2. **webfetch**：抓静态 URL 文本（HTML→markdown 简化）。
3. **第三方 web search**（后续）：接 Brave Search API / Tavily 等的 MCP server——把搜索结果当作"工具结果"喂给模型，模型负责整合。

### 5.3 检索结果作为 plan 上下文

plan 阶段产物里常带"已调研"段：
```
## 已调研
- read src/auth/login.ts (L120-180)：发现 password 校验用 bcrypt，cost=10
- webfetch https://example.com/api/v2/auth：旧 API 已弃用，需用 v3
```

检索作为 plan 的"事实证据"——让计划不靠模型记忆，靠真实信息。

---

## 6. 子 agent（sub-agent / Task tool）

### 6.1 是什么

`task` 工具让主 agent 派生一个**隔离的子 AgentSession** 执行子任务。子 session 与主 session 共享 cwd 但 messages **不互通**——子结果以摘要形式回灌主。

### 6.2 何时用

| 场景 | 例子 |
|------|------|
| 信息收集污染控制 | "派个 sub-agent 搜索所有 TODO 注释并汇总"——海量的 grep 结果不污染主 |
| 隔离风险 | "sub-agent 跑实验性脚本，崩了不影响主" |
| 并行任务 | "派两个 sub-agent 分别审计前后端"——并行加速 |
| 上下文隔离 | "sub-agent 处理图片二进制结果，避免主 loop 爆 context" |

### 6.3 与 plan/execute 的关系

sub-agent **有自己的 plan/execute**：主 agent 给目标，子 agent 自主决定 plan 然后 execute，最后回灌摘要。
- 主 plan 不需要细到"子 agent 内部怎么 plan"。
- 主 plan 需要标注"这一步用 sub-agent 完成"——便于审计。

### 6.4 实现

```ts
// 设计伪码
async executeTool_calls(toolCall) {
  if (toolCall.name === "task") {
    const subRuntime = createAgentSessionRuntime({
      cwd: this.cwd,
      agentDir: this.agentDir,
      sessionManager: this.sessionManager.createChildForTask(),
      sessionStartEvent: { reason: "subagent", parentTaskId: toolCall.id },
    });
    const result = await subRuntime.session.run(toolCall.input.prompt, this.signal);
    const summary = result.finalAssistantContent; // 截断 + 摘要
    this.session.appendAssistant({ content: `sub-agent 完成：\n${summary}` });
    return { content: [{type:"text", text: summary}], details: {subSessionId: ...} };
  }
  ...
}
```

子 session 文件与主 session **同棵 session 树**——便于 `/tree` 回溯。

---

## 7. 计划与执行的偏差校验

> execute 阶段最容易失控的点是"它实际上做了不在 plan 里的事"。dscode 用三种机制校验：

### 7.1 文件白名单校验

plan 阶段模型声明"预计修改的文件列表 `expectedFiles`"。execute 阶段每次 write/edit 完成，校验 path ∈ expectedFiles：
- 命中 → OK。
- 未命中 → 暂停 → 问用户"你要改 `foo.ts` 吗？不属于计划清单"。

### 7.2 步骤状态机

plan 是一组有序/无序 step，每 step 有状态：

```
pending → in_progress → done | failed | skipped
```

execute 推进 step；每 turn 完成后做"step 状态与实际动作对账"：
- 当前 step 标 done，但实际还有未完成动作 → 标 in_progress。
- 当前 step 失败 → 进 §9 自愈。

### 7.3 偏离检测 hook

扩展可在 `tool_call` 监听具体动作，越界就 block：

```ts
dscode.on("tool_call", (e, ctx) => {
  if (currentPlan?.deniedFiles.has(e.input.path)) {
    return { block: true, reason: "该文件被计划列入禁止修改" };
  }
});
```

这是 dscode plan mode 不靠"信任模型守约"而是靠"机制守门"的关键。

---

## 8. 计划呈现与接受

### 8.1 plan 产物 schema

```ts
interface Plan {
  goal: string;                     // 一句话目标
  assumptions: string[];            // 假设（影响评估）
  steps: PlanStep[];                // 步骤
  expectedFiles: string[];          // 预计动到的文件
  deniedFiles: string[];            // 禁止碰的文件
  risks: { description: string; mitigation: string }[];
  verification: string[];           // 完成后怎么验证（跑什么命令、看什么输出）
}

interface PlanStep {
  id: string;
  title: string;
  description: string;
  tools: string[];                  // 预计调的工具
  status: "pending" | "in_progress" | "done" | "failed" | "skipped";
}
```

### 8.2 呈现方式

TUI：分块渲染 + 可折叠（risks 高亮）。
print 模式：纯 markdown。
rpc 模式：JSON event `plan_proposed`。

### 8.3 用户决策

- `/accept-plan`：原样执行。
- 编辑后接受：用户修改 step/增删 expectedFiles，再 `/accept-plan`。
- `/reject-plan`：放弃，不执行。
- `/defer-plan`：存 plan 到 session，下次 `/plan-resume` 重新激活。

---

## 9. 错误自愈（Execute 阶段的核心循环）

> plan 是"想清楚"，execute 是"做对"。做错的回路由 §9 接管。

### 9.1 错误分类

| 级别 | 例子 | 处理 |
|------|------|------|
| **L1 工具错误** | bash 退出非零、read 文件不存在 | toolResult isError=true 回灌，模型自我修正 |
| **L2 模型错误** | tool_call 参数缺字段、调用禁用工具 | 校验/权限网关直接拒，回灌结构化错误 |
| **L3 网络错误** | 429、超时、断连 | 退避重试；持续失败 → 回灌"暂时不可用" |
| **L4 计划错误** | step 失败且自愈无果 | 暂停，问用户决策 |
| **L5 安全错误** | 权限 deny、危险命令 | §7 agentloop 权限网关；硬约束不让 |

### 9.2 自愈回路（最常用）

```
execute step
  │
  ├─ success → step done → next step
  │
  └─ failure (L1)
       │
       ├─ model 看到错误回灌，**自动重试**
       │   ├─ 同一工具不同参数（如改了命令）→ 继续
       │   └─ 同一工具相同参数重复失败 ≥2 次 → 进 L4
       │
       └─ model 切换策略
           ├─ 换工具（如 ls 失败改 find）
           ├─ 简化目标（如跳过一个 step）
           └─ 进 L4
```

dscode **不强制每次错误都问用户**——L1/L2 模型自主决策循环最多 3 次，再失败才打扰用户（避免"问麻了"）。

### 9.3 回滚

execute 阶段文件改动 dscode 记录"plan 起点 → 当前"的 git diff（自动 stash 或独立 snapshot），L4 时可一键 `git checkout` 回滚到 plan 前状态。

### 9.4 checkpoint

execute 内每完成一个 step：
- 写 step 状态到 session。
- 可选 `git commit`（让用户配 plan.checkpointOnStep = true）。
- 失败时回退到上一个 checkpoint。

---

## 10. 完成验收

execute 完成所有 step 后：

1. **运行 plan.verification 列出的验证**（"跑 npm test"、"看 build 通过"）。
2. **生成验收报告**：
   ```
   ## Plan: <goal>
   ## Steps: X/Y done, Z failed
   ## Files: list of changed files
   ## Verification: pass/fail per item
   ## Diff: stat summary
   ## Risks observed: any from plan.risks that materialized
   ```
3. **未通过验收**：不进 done，让用户决策（重试/部分接受/放弃）。
4. **通过**：清掉 plan 状态，session 留存 plan entry（可 `/tree` 回看计划）。

---

## 11. 与 Agent Loop 的耦合关系

```
User Input
  ↓
意图识别 → 任务类
  ↓
Plan Phase（Agent Loop 变体：tool_choice=auto 但写工具被权限 deny）
  ↓
/accept-plan
  ↓
Execute Phase（Agent Loop 全功能 + §7 偏差校验 + §9 自愈）
  ↓
完成验收
```

Plan 阶段的 Agent Loop 是 **agentloop.md 的受限子集**——read/grep/glob/webfetch 可用，write/edit/bash 写操作 deny，但 read-only bash（如 `ls`、`cat`）允许（要看就得能跑）。

---

## 12. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 意图识别准确 | 100 个采样输入分到正确类别 ≥ 95% |
| plan 阶段不写 | 即便模型想调 write，权限网关 100% 拒 |
| plan 必要信息齐全 | plan schema 字段（goal/steps/risks/files/verification）≥ 90% 完整 |
| execute 守约 | 改的文件超出 expectedFiles 必有暂停询问事件 |
| 自愈不烦人 | L1 错误模型自主修复成功 ≥ 80%，用户被打扰 ≤ 20% |
| 完成验收跑通 | verification 命令 100% 执行，结果诚实呈现 |
| 回滚可靠 | checkpoint 命令在 5 个真实仓库一键回到 plan 前 |

---

## 13. 反模式（明确不做）

- ❌ "plan 阶段调写工具靠模型自觉"——必须靠权限 deny 机制。
- ❌ "execute 无偏差校验"——任何文件改动都要对账 expectedFiles。
- ❌ "每错必问用户"——L1/L2 自愈必须自主，L4 才打扰。
- ❌ "plan 一次定终身"——必须可编辑、可拒绝、可 defer。
- ❌ "execute 完成不验收"——verification 必须跑，结果必须呈现。
- ❌ "sub-agent 共享主 messages"——必须隔离，靠回灌摘要通信。
- ❌ "意图识别阻塞主路径"——失败必须 fallback 到任务类，不让用户等。

---

## 14. 与其他原理文档的衔接

- plan 是 Agent Loop 的**约束层**；Agent Loop 是 execute 的执行机制——两者互不可缺。详见 原理-agentloop.md。
- 计划做完后长 execute → 消息堆 → 触发 compact。详见 原理-compact.md §3。
- sub-agent 是 Agent Loop 的**复用形态**——一个独立 loop 实例。同样见 原理-agentloop.md §10 代码骨架。
- 意图识别输入是用户文本，与上下文组装（DSCODE.md / steering）共构 system prompt 的"前置筛选"环节——架构文档 §4.2.7。
