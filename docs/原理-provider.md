# 原理：Provider（模型接入抽象）

> 状态：v0.1（设计期，v0.1 落地 DeepSeek，v0.3 多 provider，落地前以本文为准绳）
> 配套：架构文档.md §4.2.4 / 需求文档 FR-6 / 索引文档.md
> 本文回答：dscode 怎么"接一家模型就能换一家"——Provider 抽象、OpenAI 兼容流式、鉴权优先级、reasoning 解析、重试限流、prompt cache、计费。

---

## 0. TL;DR

**Provider 层是 `@dscode/ai` 包的全部职责：把"DeepSeek / OpenAI / Anthropic / 本地推理"统一成一个接口，让 Agent Loop 不关心背后是哪家模型。**

1. **抽象**：`Provider` 接口（id / api 协议 / baseUrl / apiKey / models）+ `ModelDef`（能力与成本描述）。
2. **协议**：主走 OpenAI 兼容（Chat Completions / Responses），DeepSeek 一等公民默认就是这个协议。
3. **鉴权**：`--api-key` → `auth.json` → 环境变量 → `models.json`，逐级 fallback。
4. **流式**：SSE 解析 content + tool_calls + reasoning_content。
5. **健壮性**：429/5xx 指数退避重试（≤3 次）、限流、超时。
6. **计费与 cache**：记录 input/output/cache token 与成本；DeepSeek prompt cache 感知。

---

## 1. 为什么需要 Provider 抽象

### 1.1 问题

- 不同家模型的 API 协议不同（OpenAI Chat Completions / Anthropic Messages），Agent Loop 不能为每家写一份。
- DeepSeek 是首要模型，但用户还想要 OpenAI、Anthropic、本地 Ollama——**不能锁死一家**。
- 鉴权、计费、模型目录、reasoning 处理每家都不同。

### 1.2 解法：统一抽象 + 协议适配

借鉴 OpenCode / pi：**Agent Loop 只依赖 `Provider` 接口**，具体某家通过协议适配器（adapter）接入。DeepSeek 只因为是"OpenAI 兼容 + DeepSeek 优先"，就直接用 OpenAI adapter——所以 DeepSeek 接入成本几乎为零，这正是设计的差异化点。

---

## 2. Provider / ModelDef 接口

```ts
interface Provider {
  id: string;                       // "deepseek" | "openai" | "anthropic" | "local"
  api: "openai-chat" | "openai-responses" | "anthropic-messages";
  baseUrl: string;
  apiKey: string | (() => Promise<string>);
  models: ModelDef[];
}

interface ModelDef {
  id: string;                       // "deepseek-chat"
  name: string;
  reasoning: boolean;               // R1 类：走 reasoning_content
  contextWindow: number;
  maxTokens: number;
  cost: { input; output; cacheRead; cacheWrite };
  input: ("text" | "image" | "audio")[];   // 支持的多模态输入
}
```

- `api` 字段决定用哪个 adapter：新接一家只需实现一个 adapter + 填 ModelDef，Agent Loop 零改动。
- `ModelDef.cost` 供 `/cost` 计费（FR-6.5）。

---

## 3. 鉴权优先级

```
--api-key  >  auth.json  >  DEEPSEEK_API_KEY  >  models.json 自定义
```

- `auth.json`（`~/.dscode/auth.json`）：首次引导写入，权限 0600（架构文档 §6）。
- 兼容 `DSAPI_BASE_URL` / `DSAPI_API_KEY`（用户既有环境，FR-1.3），支持自定义网关/代理（`HTTP(S)_PROXY`、baseUrl 覆盖，FR-1.4）。
- 环境变量鉴权不落盘（SC-1.2：`DEEPSEEK_API_KEY=... dscode -p hi` 直接成功）。

---

## 4. 流式与解析

### 4.1 SSE 流

- 所有 LLM 调用流式（NFR-3），走 OpenAI 兼容 SSE：`data: {...}` 事件流。
- 解析三路增量：`content` / `tool_calls`（分片拼接，见 原理-agentloop.md §5）/ `reasoning_content`。

### 4.2 reasoning_content

- DeepSeek reasoner（R1）把思考过程放 `reasoning_content`，与正文 `content` 分离。
- dscode 解析后**独立呈现**（折叠/流式/隐藏，架构文档 §10 开放问题），不混入正文。
- `ModelDef.reasoning=true` 时启用该解析。

### 4.3 多模态

- 支持 image 输入的模型，`read` 工具读到的图片作为 image 附件回传（见 原理-file-tools.md §2）。

---

## 5. 重试 / 限流 / 超时

- **重试**：429（限流）/ 5xx（服务端）指数退避，最大 3 次（FR-4.4、todos M1-S2）。
- **限流**：尊重 provider 反馈的速率限制，避免连撞。
- **超时**：单次请求超时上限，超时按可重试/不可重试分类处理。
- **错误分类**：网络错可重试、鉴权错不可重试（直接提示用户）、上下文超长走 overflow→compact（见 原理-compact.md）。

---

## 6. prompt cache 与计费

### 6.1 prompt cache

- DeepSeek context caching：重复前缀命中按低价（cacheRead）计费。
- dscode 记录 `cache_read_input_tokens` / `cache_creation_input_tokens`，并**避免频繁切前缀**破 cache（见 原理-compact.md §2.4）。

### 6.2 计费

- 每 turn 记 `usage.{prompt_tokens, completion_tokens, cache_read, cache_write}`。
- `/cost` 按 `ModelDef.cost` 换算累加，session 汇总（FR-6.5）。

---

## 7. 多 provider 与热切换

- `--provider` / `--model` 启动指定；`/model` 交互热切换、Ctrl+P 循环（FR-6.3）。
- 切换记录 `modelChange` entry 进 session（见 原理-session.md §2.2），审计可查。
- 本地 OpenAI 兼容（Ollama/vLLM/LM Studio）走同一 OpenAI adapter，仅 baseUrl 不同（FR-6.2）。

---

## 8. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 抽象解耦 | 换 provider 只动 adapter + ModelDef，Agent Loop 零改动 |
| 鉴权优先级 | `--api-key` > auth.json > env，SC-1.1/SC-1.2 通过 |
| 流式正确 | mock SSE 解析出 content + tool_calls，reasoner 解析出 reasoning_content |
| 重试生效 | mock 429 后第二次 200 成功（todos M1-S2） |
| 计费准确 | `/cost` 显示 input/output token 与成本（SC-3.3） |
| 热切换 | `/model` 切到另一家后回复成功、modelChange 入库 |

---

## 9. 反模式（明确不做）

- ❌ "Agent Loop 硬编码某家 SDK"——必须走 Provider 接口。
- ❌ "每家一套鉴权逻辑"——统一优先级 + 环境变量兼容。
- ❌ "非流式调用"——全部流式。
- ❌ "重试无上限"——≤3 次指数退避。
- ❌ "忽略 cache 切碎"——prompt cache 感知，稳定前缀。

---

## 10. 与其他原理文档的衔接

- Provider 的流式输出是 **Agent Loop** 的输入（content + tool_calls）。详见 原理-agentloop.md §5。
- prompt cache 与 token 计数被 **compact 机制**依赖。详见 原理-compact.md §2。
- 计费/ usage 写入 session entry（assistant 消息带 usage）。详见 原理-session.md。
- 鉴权文件权限（0600）与安全模型见 架构文档.md §6。