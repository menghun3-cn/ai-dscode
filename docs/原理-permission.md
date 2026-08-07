# 原理：权限与审批（Permission）

> 状态：v0.1（设计期，v0.5 落地，落地前以本文为准绳）
> 配套：架构文档.md §4.2.6 §6 / 需求文档 FR-8 / 索引文档.md
> 本文回答：模型要"动手"（写文件、跑命令、删东西）时，dscode 怎么在"让它干成事"和"别碰危险区"之间统一划线——审批模式、规则引擎、危险命令、项目信任。

---

## 0. TL;DR

**权限是 Agent 动手前的"闸门"：任何会改变系统状态的操作（write / edit / delete / bash / MCP 工具）都先过这套规则，而不是让模型自觉。**

核心机制：
1. **四级审批模式**：`read-only` / `ask`（默认）/ `auto-edit` / `full-auto`。
2. **规则引擎**：`.dscode/permissions.json` + 全局，`allow` / `deny` / `ask` 三类规则（minimatch + 命令前缀）。
3. **危险命令识别**：`rm -rf`、`sudo`、`git push --force` 等在 ask 模式始终二次确认。
4. **项目信任**：项目级扩展 / MCP server 需 `project_trust` 显式信任。
5. **判据顺序**：deny > allow > ask > 默认模式，命中即定，不模糊。

---

## 1. 为什么需要权限网关

### 1.1 问题

- 模型只是"可能干坏事"，不是"一定克制"：它可能写 `.env`、删 `node_modules`、跑 `rm -rf`、`git push --force`。
- 用户要的是"让模型能干成事"，但**危险区要守住**。
- 不同的使用场景对"放手程度"要求不同：CI 想要 headless 全自动，个人日常想要每次确认。

### 1.2 解法：审批模式 + 规则 + 危险识别

借鉴 Codex 的审批分级 + pi 的 hook 拦截（架构文档 §4.2.6）：一套**模式**控制整体放手程度，一套**规则**精准圈定 safe/dangerous，一套**危险命令表**兜底常见致命操作。三者叠加，既不误伤正常操作，也不放过真危险。

---

## 2. 四级审批模式

| 模式 | 行为 | 适用 |
|------|------|------|
| `read-only` | 只允许 read/glob/grep/ls，write/edit/bash 全 block | Plan 阶段（见 原理-plan-and-execute.md §11） |
| `ask`（默认） | 危险操作（write/edit/bash 首次、delete、rm -rf 等）弹确认 | 日常个人使用 |
| `auto-edit` | 文件编辑自动执行，bash 仍需确认 | 熟悉代码的开发者 |
| `full-auto` | 全自动（仍受 allow/deny 规则约束） | CI / headless |

- `--auto-edit` / `--full-auto` 启动覆盖；`/plan` 进入 read-only（只读规划）。
- full-auto 也**不是无约束**：deny 规则始终生效（"far-auto 也要 allow 才放真危险命令"）。

---

## 3. 规则引擎

### 3.1 配置

```jsonc
// .dscode/permissions.json（项目）+ ~/.dscode/permissions.json（全局）
{
  "allow": ["bash:git status", "bash:npm test", "read:**"],
  "deny":  ["bash:rm -rf *", "write:.env", "write:**/secrets/**"],
  "ask":   ["bash:git push *"]
}
```

### 3.2 匹配

- 工具名 + `:` + 参数/路径：`write:.env`、`bash:git status`。
- **路径**用 minimatch（glob 模式）；**命令**用前缀匹配（`bash:git push *` 命中所有 git push）。
- 判据顺序：**deny > allow > ask > 默认模式**。deny 无条件拒绝，allow 无条件放行（同模式内），ask 弹确认，未命中走默认模式。

### 3.3 持久化

- 用户确认过的"允许/拒绝"可写入 `permissions.json`，重启保留（todos M5）。

---

## 4. 危险命令识别

即使没有规则覆盖，以下命令在 ask 模式**始终二次确认**（除非 full-auto + 显式 allow）：

- `rm -rf`、`sudo`、`git push --force`、`dd`、`mkfs`、`chmod -R` 等。
- 识别基于命令前缀 + 参数模式，不依赖规则是否配置——**兜底防呆**。

---

## 5. 项目信任（project_trust）

- 项目级内容（`.dscode/extensions/`、项目 MCP server）在加载前需**显式信任**。
- 未信任 → 不加载并提示（日志可见），防止"clone 一个仓库就自动跑它的扩展"。
- 信任决策记录，已信任项目不重复问。

---

## 6. 权限与执行链的关系

```
工具调用 → 权限判定(allow/deny/ask) → [ask 确认] → 执行 → 结果
             │
             └─ 全工具统一过闸（内置 read/grep/patch/delete/bash + MCP 工具）
```

- **权限在 execute 之前**（见 原理-agentloop.md §6、原理-沙盒执行.md §4）。
- read/grep 只读默认放行；write/edit/bash/delete 过模式与规则。
- MCP 工具**不豁免权限**（见 原理-mcp.md §4）。

---

## 7. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 模式生效 | read-only 下写工具 100% block；auto-edit 文件编辑不弹框、bash 仍弹（todos M5） |
| 规则精准 | deny `write:.env` 后模型写 `.env` 被拒，文件未创建（SC-4.2） |
| 危险兜底 | `rm -rf` 在 ask 模式始终确认，拒绝不执行（SC-4.3） |
| full-auto 守线 | full-auto 下无 allow 的危险命令仍被 deny 拦 |
| 信任生效 | 未信任项目扩展 / MCP server 不加载，日志提示 |

---

## 8. 反模式（明确不做）

- ❌ "靠模型自觉不碰危险区"——必须有强制性网关。
- ❌ "权限在执行后检查"——前置。
- ❌ "full-auto 无约束"——deny 始终生效。
- ❌ "MCP 工具豁免权限"——一律过闸。
- ❌ "危险命令只靠规则配置"——内置危险表兜底。

---

## 9. 与其他原理文档的衔接

- 权限是 **Agent Loop** 工具执行链的前置闸门。详见 原理-agentloop.md §6。
- bash 沙盒执行的超时/路径/危险命令与权限共用一套安全模型。详见 原理-沙盒执行.md §4-§5。
- Plan 阶段 = read-only 模式（权限 deny 写工具）。详见 原理-plan-and-execute.md §11。
- 文件工具的路径保护（`.env`、`secrets/`）即 deny 规则的落地。详见 原理-file-tools.md §7。
- 项目信任适用于扩展加载。详见 原理-extension.md。