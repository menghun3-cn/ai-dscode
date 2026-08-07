# 原理：Web Search（信息检索）

> 状态：v0.1（设计期，落地前以本文为准绳）
> 配套：架构文档.md / 需求文档 FR-3.8（webfetch）/ 索引文档.md
> 本文回答：模型需要"仓库之外的知识"时——查文档、查 API、查最新资讯——dscode 怎么把 web 检索接进 Agent Loop，且不让海量网页内容污染上下文。

---

## 0. TL;DR

**Web Search 是 Agent 的"外部记忆"：当代码、文档、模型参数之外的信息缺失时，检索网页并回喂模型。核心是两条链——搜索（搜到链接）与抓取（读页面）——且两者都必须受"上下文卫生"约束。**

1. **`webfetch`**（FR-3.8）：抓指定 URL，转成干净文本回传模型（feed 模型理解外部内容）。
2. **`websearch`**（检索）：给查询词 → 返回标题/URL/摘要列表；模型决定抓哪些。
3. **上下文卫生**：搜索结果只回"标题+URL+摘要"（不整页）；抓取有大小上限与 HTML 转文本清洗，防污染。
4. **与 plan/execute 的关系**：检索是 execute 阶段的信息获取手段，也可作为 plan 阶段的事实核查。

---

## 1. 为什么需要 web 检索

### 1.1 问题

- 模型参数有截止日期：新库、新 API、新版本行为它不知道。
- 用户仓库信息不全：依赖文档、上游 issue、最佳实践在外面。
- 但 web 是"海量噪声源"：整页 HTML、广告、超长文章，直接喂模型 → context 爆炸 + 注意力稀释。

### 1.2 解法：搜索 + 抓取两段式

业界共识（Claude Code WebSearch/WebFetch、pi）：**先搜出候选（轻量），再按需抓取（受控）**。搜索阶段只回"链接+摘要"，模型凭摘要判断值得读哪个——避免把整个互联网拖进 context。

---

## 2. 工具形态

### 2.1 `webfetch`

```ts
{ url: string, maxChars?: number } → { title, content(清洗后文本), truncated }
```

- 抓取页面 → HTML → **转干净文本**（去脚本/样式/导航噪声）。
- 大小上限（maxChars，默认若干 KB）截断，标记 truncated。
- 失败（404/超时/非文本）→ 结构化错误回传，模型自愈。

### 2.2 `websearch`

```ts
{ query: string, maxResults?: number } → { results: [{ title, url, snippet }] }
```

- 返回**标题 + URL + 摘要**，不返回整页内容。
- `maxResults` 截断（默认个位数），防列表本身撑爆 context。
- 检索后端可插拔（内置搜索 API / provider 扩展），本期先落地一条链路。

---

## 3. 上下文卫生（关键约束）

| 环节 | 卫生手段 |
|------|---------|
| 搜索结果 | 只回 title/url/snippet，不整页 |
| 页面抓取 | HTML→文本清洗 + maxChars 截断 |
| 检索密度 | 模型一次抓取 ≤ N 页，防连读一串长文 |
| 结果留存 | 有价值内容可落成 session 笔记，不靠重复抓取 |

**目标**：web 检索是"精准取用"，不是"把网页灌进 context"。这也是 sub-agent 场景的典型做法：检索结果先聚合再回主 loop（见 原理-plan-and-execute.md §6）。

---

## 4. 与 Agent Loop 的耦合

- `websearch` / `webfetch` 是普通工具，走标准 tool_call 协议（原理-agentloop.md §4）。
- 典型链：`websearch("某库 最新版本 API")` → 模型挑 1-2 个 URL → `webfetch` 读详情 → 结论用于后续工具调用。
- 权限：网络访问默认允许（只读），但 deny 规则可拦特定域名（如内网/本地地址）；`webfetch` 对 localhost/私网地址应拒绝（SSRF 防护）。

---

## 5. 与 plan-and-execute 的关系

- **plan 阶段**：检索用作事实核查（"这个库是否支持 X"），产出计划更可靠；只读，天然符合 plan 模式。
- **execute 阶段**：检索是"执行中遇到未知"的 L1 自愈手段（查报错、查 API 用法）——见 原理-plan-and-execute.md §9。
- 检索结果可作为计划/执行的证据记录，进 session 审计。

---

## 6. 抓手与判据

| 抓手 | 判据 |
|------|------|
| 搜索返回 | query → 返回 title/url/snippet 列表，不整页 |
| 抓取可控 | webfetch 输出 ≤ maxChars 并标记 truncated，HTML 噪声被清洗 |
| 不污染 context | 单次检索相关 token 有上限，模型不会连读 N 页长文 |
| SSRF 防护 | webfetch 对 localhost/私网地址拒绝 |
| 检索可用 | 模型凭摘要能选出正确页面并拿到所需事实 |

---

## 7. 反模式（明确不做）

- ❌ "搜索返回整页内容"——只回摘要。
- ❌ "webfetch 无上限"——必截断。
- ❌ "结果直接堆进 system prompt"——作为工具结果走 user/tool 消息。
- ❌ "内网/本地地址随便抓"——SSRF 防护必须有。

---

## 8. 与其他原理文档的衔接

- websearch/webfetch 是 **Agent Loop 的普通工具**，走同一套 tool_call 协议。详见 原理-agentloop.md。
- 检索是 **plan-and-execute 的"信息检索作为执行"** 与 L1 自愈手段。详见 原理-plan-and-execute.md §5/§9。
- 抓回的长文本仍可能触发 compact。详见 原理-compact.md。
- 扩展可替换检索后端（FR-10 registerTool 同理）。