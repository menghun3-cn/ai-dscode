/**
 * AgentSession：一次 Agent 会话（原理-agentloop.md §3、架构文档 §4.2.1）。
 * - 持有 messages / loop 状态与 cwd 绑定的 services
 * - run() 以异步生成器驱动 Agent Loop，产出 AgentEvent（流式消费）
 * - 并行执行同轮 tool_calls，错误隔离不连环崩
 * - dispose() 释放（M1-S4 验收：new + dispose 无异常）
 */

import type { ChatMessage, ToolCall, StreamEvent } from '@dscode/ai';
import type { ToolRegistry } from '../tool.js';
import type { AgentEvent } from './events.js';
import { assembleSystemPrompt } from './prompt.js';

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
  private readonly tools: ToolRegistry;
  private readonly client: ChatStreamer;
  private modelId: string;
  private readonly maxTurns: number;
  private readonly systemPromptExtra?: string;
  private readonly debug: boolean;
  private readonly abortController = new AbortController();
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
  }

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
    this.systemPrompt = await assembleSystemPrompt({
      tools: this.tools.getAll(),
      cwd: this.cwd,
      extra: this.systemPromptExtra,
      debug: this.debug,
    });
  }

  /**
   * Agent Loop 主循环（原理-agentloop.md §3）：
   * prompt → LLM → tool_calls → 执行 → 结果回喂 → 再 LLM，直到无 tool_call 或达上限。
   */
  async *run(input: string): AsyncGenerator<AgentEvent> {
    if (this.disposed) throw new Error('session 已 dispose');
    if (!this.systemPrompt) await this.prepare();

    this.messages.push({ role: 'user', content: input });
    yield { type: 'agent_start', input };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (this.abortController.signal.aborted) {
        yield { type: 'agent_settled', reason: 'aborted' };
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

      // 收敛：无 tool_call → 结束
      if (toolCalls.length === 0) {
        yield { type: 'agent_settled', reason: 'no-tool-calls' };
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
        yield { type: 'tool_result', ...o };
      }
    }

    yield { type: 'agent_settled', reason: 'max-turns' };
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
