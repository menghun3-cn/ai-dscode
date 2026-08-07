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
  private readonly client: ChatStreamer;
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
    this.client = opts.client;
    this.modelId = opts.model ?? 'deepseek-chat';
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

  setModel(id: string): void {
    this.modelId = id;
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
        yield { type: 'agent_settled', reason: 'aborted', usage };
        return;
      }

      // LLM 调用（流式）
      let content = '';
      const toolCalls: ToolCall[] = [];
      const stream = this.client.streamChat({
        model: this.modelId,
        messages: [{ role: 'system', content: this.systemPrompt }, ...this.messages],
        tools: this.tools.toOpenAITools(),
        signal: this.abortController.signal,
      });
      for await (const ev of stream) {
        if (ev.content) {
          content += ev.content;
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
        await this.persist();
        yield { type: 'agent_settled', reason: 'no-tool-calls', usage };
        return;
      }

      // 先发出 tool_call 事件，再并行执行（事件设计见 events.ts / 原理-agentloop.md §8）
      for (const tc of toolCalls) {
        yield { type: 'tool_call', toolCallId: tc.id, toolName: tc.function.name, args: tc.function.arguments };
      }
      // 并行执行（错误隔离：单工具失败不连坐）
      const outcomes = await Promise.all(toolCalls.map((tc) => this.executeTool(tc)));
      for (const o of outcomes) {
        this.messages.push({ role: 'tool', tool_call_id: o.toolCallId, content: o.output });
        this.pushEntry('toolResult', { role: 'tool', content: o.output, toolCallId: o.toolCallId });
        yield { type: 'tool_result', ...o };
      }
    }

    await this.persist();
    yield { type: 'agent_settled', reason: 'max-turns', usage };
  }

  /** 执行单个工具调用；任何异常都转为 isError 结果而非 reject（错误隔离） */
  private async executeTool(tc: ToolCall): Promise<ToolCallOutcome> {
    const toolCallId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
    const toolName = tc.function.name;
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { toolCallId, toolName, output: `未知工具: ${toolName}`, isError: true };
    }
    let params: Record<string, unknown>;
    try {
      params = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
    } catch {
      return { toolCallId, toolName, output: `工具参数不是合法 JSON: ${tc.function.arguments}`, isError: true };
    }
    try {
      const result = await tool.execute(toolCallId, params as never, {
        cwd: this.cwd,
        signal: this.abortController.signal,
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
}
