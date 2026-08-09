/**
 * AgentSession：一次 Agent 会话（原理-agentloop.md §3、架构文档 §4.2.1）。
 * - 持有 messages / loop 状态与 cwd 绑定的 services
 * - run() 以异步生成器驱动 Agent Loop，产出 AgentEvent（流式消费）
 * - 并行执行同轮 tool_calls，错误隔离不连环崩
 * - dispose() 释放（M1-S4 验收：new + dispose 无异常）
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, ToolCall, StreamEvent, StreamUsage } from '@dscode/ai';
import type { ToolRegistry } from '../tool.js';
import type { AgentEvent } from './events.js';
import { assembleSystemPrompt } from './prompt.js';
import { SessionManager } from '../session/manager.js';
import { buildContextEntries, branchPath } from '../session/context.js';
import { newEntryId, type SessionEntry } from '../session/entries.js';
import { EventBus } from '../extension/bus.js';
import type { ExtensionToolDef } from '../extension/api.js';
import { SkillManager } from '../skill/skill.js';
import { PermissionEngine, isDangerousCommand } from '../permission/permission.js';
import { PlanManager, WRITE_TOOLS } from '../plan/plan.js';
import { selectCutPoint, serializeMessages, summarizeMessages, estimateMessagesTokens } from '../compact/compact.js';

/** LLM client 最小接口：@dscode/ai 的 OpenAIClient 结构化满足，测试可 mock */
export interface ChatStreamer {
  streamChat(opts: {
    model: string;
    messages: ChatMessage[];
    tools?: { type: 'function'; function: { name: string; description: string; parameters: unknown } }[];
    signal?: AbortSignal;
  }): AsyncGenerator<StreamEvent>;
}

export interface AgentSessionOptions {
  cwd: string;
  tools: ToolRegistry;
  client: ChatStreamer;
  /** M3：按模型切换 client（跨 provider 时换协议 client；无则仅切 model id） */
  clientFactory?: (modelId: string) => ChatStreamer | undefined;
  /** M4：扩展事件总线（缺省自建空总线） */
  bus?: EventBus;
  /** M5：权限引擎（危险命令二次确认；缺省自建，无确认回调时默认拒绝） */
  permission?: PermissionEngine;
  /** M6：自动压缩阈值（估算 token 超限即触发，SC-5.1；默认 40000，可用 DSCODE_COMPACT_THRESHOLD 覆盖） */
  compactThreshold?: number;
  /** M4：扩展注册的工具（executeTool 未命中内置时回退）；可传 supplier 支持 /reload 后取最新 */
  extTools?: ExtensionToolDef[] | (() => ExtensionToolDef[]);
  model?: string;
  maxTurns?: number;
  systemPromptExtra?: string;
  debug?: boolean;
  /** M2：复用已有 session id（resume）；缺省则新建并自动持久化 */
  sessionId?: string;
  /** 是否自动落盘（测试可关）；默认 true */
  persist?: boolean;
}

export interface ToolCallOutcome {
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

export class AgentSession {
  readonly messages: ChatMessage[] = [];
  readonly cwd: string;
  /** M2：session id（resume/fork/clone 用） */
  readonly sessionId: string;
  /** M2：完整 session 树（可审计历史；LLM 视角由 buildContextEntries 折叠） */
  readonly entries: SessionEntry[] = [];
  /** 当前激活分支的末端 entry id */
  private activeEntryId: string | null = null;
  private readonly sessionManager: SessionManager;
  private readonly persistEnabled: boolean;
  private readonly tools: ToolRegistry;
  private readonly bus: EventBus;
  private readonly extTools: ExtensionToolDef[];
  private readonly extToolsSupplier?: () => ExtensionToolDef[];
  private readonly skillManager: SkillManager;
  private readonly permission: PermissionEngine;
  private readonly compactThreshold: number;
  /** M5：Plan 模式（/plan 只读 → /accept-plan 落地，SC-4.4） */
  readonly plan = new PlanManager();
  private client: ChatStreamer;
  private readonly clientFactory?: (modelId: string) => ChatStreamer | undefined;
  private modelId: string;
  private readonly maxTurns: number;
  private readonly systemPromptExtra?: string;
  private readonly debug: boolean;
  private abortController = new AbortController();
  private disposed = false;
  private systemPrompt = '';

  constructor(opts: AgentSessionOptions) {
    this.cwd = opts.cwd;
    this.tools = opts.tools;
    this.bus = opts.bus ?? new EventBus();
    this.skillManager = new SkillManager({ cwd: opts.cwd });
    this.permission = opts.permission ?? new PermissionEngine();
    this.compactThreshold = opts.compactThreshold ?? (Number(process.env['DSCODE_COMPACT_THRESHOLD']) || 40_000);
    if (typeof opts.extTools === 'function') {
      this.extToolsSupplier = opts.extTools;
      this.extTools = [];
    } else {
      this.extTools = opts.extTools ?? [];
    }
    this.client = opts.client;
    this.clientFactory = opts.clientFactory;
    this.modelId = opts.model ?? 'deepseek-v4-flash';
    this.maxTurns = opts.maxTurns ?? 50;
    this.systemPromptExtra = opts.systemPromptExtra;
    this.debug = opts.debug ?? process.env.DSCODE_DEBUG === '1';
    this.sessionId = opts.sessionId ?? randomUUID();
    this.sessionManager = new SessionManager(opts.cwd);
    this.persistEnabled = opts.persist ?? true;
    if (opts.sessionId) this.pendingRestore = true;
  }

  /** resume：等待 prepare() 时从磁盘加载历史 */
  private pendingRestore = false;

  /** 当前模型 id（/model 查询与切换，M1-S5） */
  get model(): string {
    return this.modelId;
  }

  /** /name 设置的会话名（从 entries 反向找最后一个 label entry；无则 undefined） */
  get name(): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.type === 'label' && e.name) return e.name;
    }
    return undefined;
  }

  setModel(id: string): void {
    this.modelId = id;
    // M3：跨 provider 切换时经 factory 重建协议 client
    if (this.clientFactory) {
      const next = this.clientFactory(id);
      if (next) this.client = next;
    }
    // M4：model_select 事件
    void this.bus.emit('model_select', { model: id });
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * 中止当前运行（Ctrl+C 中断，SC-1.9）。
   * 只中止不 dispose，会话可继续使用；单次中止后 abortController 不可复用。
   */
  abort(): void {
    this.abortController.abort();
  }

  dispose(): void {
    this.disposed = true;
    this.abortController.abort();
  }

  /** 组装 system prompt（含 DSCODE.md / steering，见 prompt.ts） */
  async prepare(): Promise<void> {
    // resume：从磁盘加载历史（若有 sessionId），再重建 LLM 视角
    if (this.pendingRestore) {
      this.pendingRestore = false;
      const loaded = await this.sessionManager.read(this.sessionId);
      if (loaded.length > 0) {
        this.entries.push(...loaded);
        this.savedCount = this.entries.length;
        this.activeEntryId = this.entries[this.entries.length - 1]!.id;
        this.messages.push(...buildContextEntries(this.entries, this.activeEntryId));
      }
    }
    this.systemPrompt = await assembleSystemPrompt({
      tools: this.tools.getAll(),
      cwd: this.cwd,
      extra: this.systemPromptExtra,
      debug: this.debug,
    });
  }

  /** 追加一个 entry 并推进激活分支；返回新 entry */
  private pushEntry(type: SessionEntry['type'], fields: Partial<SessionEntry> = {}): SessionEntry {
    const entry: SessionEntry = {
      id: newEntryId(type === 'toolResult' ? 't' : type === 'assistant' ? 'a' : 'u'),
      parentId: this.activeEntryId,
      type,
      timestamp: Date.now(),
      ...fields,
    };
    this.entries.push(entry);
    this.activeEntryId = entry.id;
    return entry;
  }

  /** 把新增 entry 追加落盘（JSONL 追加写，见 原理-session.md §5） */
  private savedCount = 0;
  private async persist(): Promise<void> {
    if (!this.persistEnabled) return;
    const unsaved = this.entries.slice(this.savedCount);
    for (const e of unsaved) {
      await this.sessionManager.append(this.sessionId, e);
    }
    this.savedCount = this.entries.length;
  }

  /** 分支路径（从根到当前激活节点）——/tree 展示与 fork 用 */
  get activeBranch(): SessionEntry[] {
    return branchPath(this.entries, this.activeEntryId);
  }

  /** /tree：跳到历史节点，从该处改写分支（activeEntryId 迁移） */
  jumpTo(entryId: string): boolean {
    if (!this.entries.some((e) => e.id === entryId)) return false;
    this.activeEntryId = entryId;
    return true;
  }

  /**
   * /tree 切分支（branch summary，原理-compact.md 附产品 / 原理-session.md §3.4）：
   * 迁移激活分支时，对被放弃的尾段写 branchSummary entry（切回时靠摘要恢复关键事实）。
   */
  async switchBranch(entryId: string): Promise<string> {
    if (!this.entries.some((e) => e.id === entryId)) return '无效节点';
    const oldBranch = this.activeBranch;
    this.activeEntryId = entryId;
    const newIds = new Set(this.activeBranch.map((e) => e.id));
    // 被弃段：旧分支里不在新分支路径上的条目（自切换点之后的分叉尾段）
    const abandoned = oldBranch.filter((e) => !newIds.has(e.id) && e.type !== 'branchSummary');
    if (abandoned.length > 0) {
      const text = abandoned.map((e) => `[${e.type}] ${(e.content ?? e.name ?? '').slice(0, 300)}`).join('\n');
      this.pushEntry('branchSummary', { content: `被放弃分支摘要：\n${text}` });
      await this.persist();
    }
    return `已切到节点 ${entryId.slice(0, 8)}…（被弃 ${abandoned.length} 条已存分支摘要）`;
  }

  /** /fork：从历史节点生成新 session 文件（旧文件不变，SC-2.4） */
  async forkFrom(entryId: string): Promise<string> {
    const path = branchPath(this.entries, entryId);
    return this.sessionManager.create(path);
  }

  /** /clone：复制当前分支到新 session（原 session 不动） */
  async clone(): Promise<string> {
    return this.sessionManager.create([...this.activeBranch]);
  }

  /** /name：给会话命名（label entry），并落盘 */
  async label(name: string): Promise<void> {
    this.pushEntry('label', { name });
    await this.persist();
  }

  /** /skill:<name>：加载 skill 指令注入 system prompt（渐进披露，原理-agentloop.md §7） */
  async applySkill(name: string): Promise<boolean> {
    const skill = await this.skillManager.load(name);
    if (!skill) return false;
    this.systemPrompt = `${this.systemPrompt}\n\n## Skill: ${skill.name}\n${skill.content}`;
    return true;
  }

  /** 列出可用 skill 名 */
  async listSkills(): Promise<string[]> {
    return this.skillManager.list();
  }

  /** M6 自动压缩：估算 token 超阈值即触发（SC-5.1） */
  private async maybeAutoCompact(): Promise<void> {
    if (estimateMessagesTokens(this.messages) > this.compactThreshold) {
      await this.compact();
    }
  }

  /**
   * Compaction（原理-compact.md、SC-5.1/5.2）：
   * 把 messages 中远离焦点的旧段压缩为摘要，写 compaction entry 并重建 LLM 视图。
   * @param extra /compact 附加指令（如"重点保留测试相关上下文"）
   * @param keepRecentTokens 保留最近估算 token 量（默认 8000）
   */
  async compact(extra?: string, keepRecentTokens = 8_000): Promise<string> {
    // 扩展自定义摘要：session_before_compact 返回 { block:true, reason:<摘要> } 则覆盖 LLM 摘要（todos M6 P1）
    const before = await this.bus.emit('session_before_compact', { tokensBefore: estimateMessagesTokens(this.messages) });
    let summary: string | null = before?.block && before.reason ? before.reason : null;

    const cut = selectCutPoint(this.messages, keepRecentTokens);
    if (cut.cutIndex === 0 && !summary) return '上下文未达到压缩阈值';

    if (!summary) {
      const cutMessages = this.messages.slice(0, cut.cutIndex);
      summary = await summarizeMessages(this.client, cutMessages, { model: this.modelId, extra });
      // 降级：LLM 摘要失败时用截断文本兜底
      if (!summary) {
        summary = `（摘要降级：截断）\n${serializeMessages(cutMessages).slice(0, 2000)}`;
      }
    }

    // 写 compaction entry（M2 已建类型；buildContextEntries 会折叠为 [压缩摘要] user 消息）
    this.pushEntry('compaction', { content: summary });
    // 重建 LLM 视图：摘要 user 消息 + 保留段
    const kept = this.messages.slice(cut.cutIndex);
    this.messages.length = 0;
    this.messages.push({ role: 'user', content: `[压缩摘要] ${summary}` }, ...kept);
    await this.persist();
    return `已压缩（切掉 ${cut.cutTokens} tok 估量，保留 ${kept.length} 条消息）：\n${summary}`;
  }

  /**
   * Agent Loop 主循环（原理-agentloop.md §3）：
   * prompt → LLM → tool_calls → 执行 → 结果回喂 → 再 LLM，直到无 tool_call 或达上限。
   */
  async *run(input: string): AsyncGenerator<AgentEvent> {
    if (this.disposed) throw new Error('session 已 dispose');
    if (!this.systemPrompt) await this.prepare();

    // 上次 abort（Ctrl+C / 超时中止）只影响当时那轮：每次 run 换全新 AbortController，
    // 避免一次性信号污染后续对话（修复"中止后再次对话一直报错"）
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }

    this.messages.push({ role: 'user', content: input });
    this.pushEntry('user', { role: 'user', content: input });
    // M4：扩展事件（before_agent_start / agent_start）
    await this.bus.emit('before_agent_start', { input });
    await this.bus.emit('agent_start', { input });
    yield { type: 'agent_start', input };

    // 累计所有 LLM 调用轮的 usage（tokens 数据源，供 TUI 显示）
    const usage: StreamUsage = {};
    const accumulateUsage = (evUsage: StreamUsage) => {
      usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (evUsage.prompt_tokens ?? 0);
      usage.completion_tokens = (usage.completion_tokens ?? 0) + (evUsage.completion_tokens ?? 0);
      usage.cache_read_input_tokens = (usage.cache_read_input_tokens ?? 0) + (evUsage.cache_read_input_tokens ?? 0);
      usage.cache_creation_input_tokens = (usage.cache_creation_input_tokens ?? 0) + (evUsage.cache_creation_input_tokens ?? 0);
    };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (this.abortController.signal.aborted) {
        await this.persist();
        await this.bus.emit('agent_settled', { reason: 'aborted', usage });
        await this.bus.emit('agent_end', { reason: 'aborted' });
        yield { type: 'agent_settled', reason: 'aborted', usage };
        return;
      }
      await this.bus.emit('turn_start', { turn });

      // LLM 调用（流式）；tools = 内置 + 扩展工具（M4：模型需感知扩展工具才能调用）
      const extTools = this.extToolsSupplier ? this.extToolsSupplier() : this.extTools;
      const tools = [
        ...this.tools.toOpenAITools(),
        ...extTools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      ];
      let content = '';
      const toolCalls: ToolCall[] = [];
      const stream = this.client.streamChat({
        model: this.modelId,
        messages: [{ role: 'system', content: this.systemPrompt }, ...this.messages],
        tools,
        signal: this.abortController.signal,
      });
      for await (const ev of stream) {
        if (ev.content) {
          content += ev.content;
          await this.bus.emit('message_update', { content: ev.content });
          yield { type: 'message_update', content: ev.content };
        }
        if (ev.reasoningContent) {
          yield { type: 'reasoning_update', content: ev.reasoningContent };
        }
        if (ev.usage) accumulateUsage(ev.usage);
        // tool_calls 增量按 index 累积后的当前状态（见 client.ts parseChunk）
        if (ev.toolCalls && ev.toolCalls.length > 0) {
          toolCalls.length = 0;
          toolCalls.push(...ev.toolCalls);
        }
      }

      this.messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
      this.pushEntry('assistant', {
        role: 'assistant',
        content: content || null,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
      });

      // 收敛：无 tool_call → 结束
      if (toolCalls.length === 0) {
        await this.maybeAutoCompact();
        await this.persist();
        await this.bus.emit('agent_settled', { reason: 'no-tool-calls', usage });
        await this.bus.emit('agent_end', { reason: 'no-tool-calls' });
        yield { type: 'agent_settled', reason: 'no-tool-calls', usage };
        return;
      }

      // 先发出 tool_call 事件（扩展可 block），再并行执行
      const blocked: Array<{ tc: ToolCall; reason: string }> = [];
      for (const tc of toolCalls) {
        yield { type: 'tool_call', toolCallId: tc.id, toolName: tc.function.name, args: tc.function.arguments };
        const verdict = await this.bus.emit('tool_call', {
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: tc.function.arguments,
        });
        if (verdict?.block) blocked.push({ tc, reason: verdict.reason ?? '被扩展拦截' });
      }
      // 并行执行（错误隔离：单工具失败不连坐）；被 block 的工具直接产出 isError 结果
      const outcomes = await Promise.all(
        toolCalls.map((tc) => {
          const b = blocked.find((x) => x.tc.id === tc.id);
          return b
            ? Promise.resolve({ toolCallId: tc.id, toolName: tc.function.name, output: `[blocked] ${b.reason}`, isError: true })
            : this.executeTool(tc);
        }),
      );
      for (const o of outcomes) {
        this.messages.push({ role: 'tool', tool_call_id: o.toolCallId, content: o.output });
        this.pushEntry('toolResult', { role: 'tool', content: o.output, toolCallId: o.toolCallId });
        await this.bus.emit('tool_result', { toolCallId: o.toolCallId, toolName: o.toolName, output: o.output, isError: o.isError });
        yield { type: 'tool_result', ...o };
      }
      await this.bus.emit('turn_end', { turn });
    }

    await this.maybeAutoCompact();
    await this.persist();
    await this.bus.emit('agent_settled', { reason: 'max-turns', usage });
    await this.bus.emit('agent_end', { reason: 'max-turns' });
    yield { type: 'agent_settled', reason: 'max-turns', usage };
  }

  /** 权限检查（M5，SC-4.3）：bash 危险命令二次确认；写工具按审批模式分派（M5-S5）；放行返回 null，拦截返回原因 */
  private async checkPermission(toolName: string, params: Record<string, unknown>): Promise<string | null> {
    const writeTool = WRITE_TOOLS.has(toolName);
    if (toolName === 'bash') {
      const command = String(params['command'] ?? '');
      const danger = isDangerousCommand(command);
      if (danger) {
        const verdict = await this.permission.check(`bash:${command}`, { dangerousReason: danger, writeTool });
        if (!verdict.allow) return verdict.reason ?? '危险操作被拒绝';
      }
      return null;
    }
    if (writeTool) {
      const verdict = await this.permission.check(`${toolName}:${JSON.stringify(params)}`, { writeTool });
      if (!verdict.allow) return verdict.reason ?? '写操作被拒绝';
    }
    return null;
  }

  /** 执行单个工具调用；任何异常都转为 isError 结果而非 reject（错误隔离） */
  private async executeTool(tc: ToolCall): Promise<ToolCallOutcome> {
    const toolCallId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
    const toolName = tc.function.name;
    const tool = this.tools.get(toolName);
    let params: Record<string, unknown>;
    try {
      params = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
    } catch {
      return { toolCallId, toolName, output: `工具参数不是合法 JSON: ${tc.function.arguments}`, isError: true };
    }
    // M4：扩展注册的工具回退（未命中内置时；supplier 取最新，支持 /reload）
    const extTools = this.extToolsSupplier ? this.extToolsSupplier() : this.extTools;
    if (!tool) {
      // M5：扩展工具也走权限检查（危险命令等）
      const ext = extTools.find((t) => t.name === toolName);
      if (!ext) {
        return { toolCallId, toolName, output: `未知工具: ${toolName}`, isError: true };
      }
      const extVerdict = await this.checkPermission(toolName, params);
      if (extVerdict !== null) return { toolCallId, toolName, output: `[权限拦截] ${toolName}（${extVerdict}）`, isError: true };
      try {
        const result = await ext.execute(params);
        return { toolCallId, toolName, output: result.output, isError: !!result.isError };
      } catch (err) {
        return {
          toolCallId,
          toolName,
          output: `扩展工具异常: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    }
    // M5：Plan 模式写工具拒绝（SC-4.4：/plan 只读）
    if (this.plan.isActive && WRITE_TOOLS.has(toolName)) {
      return {
        toolCallId,
        toolName,
        output: `[plan 只读] ${toolName} 在 Plan 模式下被拒绝。请用 /accept-plan 接受计划后再执行。`,
        isError: true,
      };
    }
    // M5：危险命令二次确认（bash 等，SC-4.3）
    const verdict = await this.checkPermission(toolName, params);
    if (verdict !== null) {
      return { toolCallId, toolName, output: `[权限拦截] ${toolName}: ${params['command'] ?? toolName}（${verdict}）`, isError: true };
    }
    try {
      const result = await tool.execute(toolCallId, params as never, {
        cwd: this.cwd,
        signal: this.abortController.signal,
        // M5：sub-agent 工厂——隔离 AgentSession 执行（SC-4.5）
        subAgent: (prompt) => this.runSubAgent(prompt),
      });
      return { toolCallId, toolName, output: result.output, isError: !!result.isError };
    } catch (err) {
      return {
        toolCallId,
        toolName,
        output: `工具执行异常: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  /** 派生隔离的子 AgentSession 执行子任务，结果截断摘要回传（原理-plan-and-execute.md §6.4） */
  private async runSubAgent(prompt: string): Promise<string> {
    const sub = new AgentSession({
      cwd: this.cwd,
      tools: this.tools,
      client: this.client,
      bus: new EventBus(), // 子会话独立总线：扩展事件不重复触发
      permission: this.permission,
      persist: false, // 子会话不落盘
      debug: this.debug,
    });
    await sub.prepare();
    let out = '';
    for await (const ev of sub.run(prompt)) {
      if (ev.type === 'message_update') out += ev.content;
    }
    const trimmed = out.length > 4000 ? `${out.slice(0, 4000)}…（已截断）` : out;
    return trimmed || '（子 agent 无输出）';
  }
}
