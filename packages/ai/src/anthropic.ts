/**
 * Anthropic Messages 协议 client（架构文档 §4.2.4、需求 FR-6.2）。
 * 把 Anthropic 的流式 SSE 事件（content_block_delta / tool_use / thinking）
 * 统一解析为 StreamEvent，与 OpenAIClient 同构，供 Agent Loop 无差别消费。
 */

import { SSEParser } from './sse.js';
import { ApiError, type FetchLike } from './client.js';
import type { ChatMessage, ChatCompletionOptions, StreamEvent, StreamUsage, ToolCall } from './types.js';

export interface AnthropicClientOptions {
  baseUrl: string;
  apiKey: string | (() => Promise<string>);
  fetchImpl?: FetchLike;
  maxRetries?: number;
  timeoutMs?: number;
}

/** tool_use 累积器：index → 完整块（name 在 content_block_start，input 由 partial_json 拼接） */
interface ToolUseAcc {
  id: string;
  name: string;
  input: string;
}

export class AnthropicClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | (() => Promise<string>);
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  private async resolveKey(): Promise<string> {
    return typeof this.apiKey === 'function' ? this.apiKey() : this.apiKey;
  }

  /** ChatMessage[] → Anthropic Messages 请求体（tool_result 并入 user 消息） */
  private buildBody(opts: ChatCompletionOptions): Record<string, unknown> {
    const system: string[] = [];
    const messages: Array<Record<string, unknown>> = [];
    for (const m of opts.messages) {
      if (m.role === 'system') {
        system.push(m.content ?? '');
        continue;
      }
      if (m.role === 'tool') {
        // Anthropic：tool_result 必须作为 user 消息的 content block
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }],
        });
        continue;
      }
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') });
        }
      }
      messages.push({ role: m.role, content: blocks });
    }
    const tools = (opts.tools ?? []).map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    return {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      stream: true,
      ...(system.length > 0 ? { system: system.join('\n\n') } : {}),
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    };
  }

  /** 流式 chat：逐事件产出 content / reasoningContent / toolCalls / usage / finishReason */
  async *streamChat(opts: ChatCompletionOptions): AsyncGenerator<StreamEvent> {
    const key = await this.resolveKey();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const stallError = () => new Error(`provider 响应停滞（${this.timeoutMs}ms 无数据）`);
    const connectTimer = setTimeout(() => controller.abort(stallError()), this.timeoutMs);
    connectTimer.unref?.();
    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(this.buildBody(opts)),
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
      if (!res.body) throw new ApiError('响应无 body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SSEParser();
      const toolAcc = new Map<number, ToolUseAcc>();
      const usage: StreamUsage = {};
      for (;;) {
        const { done, value } = await readWithIdle(reader, this.timeoutMs, () => controller.abort(stallError()));
        if (done) break;
        for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
          const event = this.parseEvent(ev, toolAcc, usage);
          if (event) yield event;
        }
        if (parser.isDone) break;
      }
    } finally {
      clearTimeout(connectTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** 单个 Anthropic SSE 事件 → StreamEvent（或 undefined 忽略） */
  private parseEvent(raw: Record<string, unknown>, toolAcc: Map<number, ToolUseAcc>, usage: StreamUsage): StreamEvent | undefined {
    const type = raw['type'] as string;
    const event: StreamEvent = {};
    switch (type) {
      case 'message_start': {
        const message = raw['message'] as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined;
        if (message?.usage) {
          usage.prompt_tokens = message.usage.input_tokens ?? 0;
          usage.cache_read_input_tokens = message.usage.cache_read_input_tokens ?? 0;
          usage.cache_creation_input_tokens = message.usage.cache_creation_input_tokens ?? 0;
        }
        return undefined;
      }
      case 'content_block_start': {
        const block = raw['content_block'] as { type?: string; id?: string; name?: string } | undefined;
        if (block?.type === 'tool_use') {
          const index = raw['index'] as number;
          toolAcc.set(index, { id: block.id ?? '', name: block.name ?? '', input: '' });
        }
        return undefined;
      }
      case 'content_block_delta': {
        const delta = raw['delta'] as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
        const index = raw['index'] as number;
        if (delta?.type === 'text_delta' && delta.text) event.content = delta.text;
        else if (delta?.type === 'thinking_delta' && delta.thinking) event.reasoningContent = delta.thinking;
        else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          const acc = toolAcc.get(index);
          if (acc) acc.input += delta.partial_json;
          return undefined;
        }
        return Object.keys(event).length > 0 ? event : undefined;
      }
      case 'content_block_stop': {
        const acc = toolAcc.get(raw['index'] as number);
        if (acc) {
          const tc: ToolCall = { id: acc.id, type: 'function', function: { name: acc.name, arguments: acc.input } };
          event.toolCalls = [tc];
        }
        return Object.keys(event).length > 0 ? event : undefined;
      }
      case 'message_delta': {
        const delta = raw['delta'] as { stop_reason?: string } | undefined;
        const u = raw['usage'] as { output_tokens?: number } | undefined;
        if (u?.output_tokens !== undefined) usage.completion_tokens = u.output_tokens;
        event.finishReason = delta?.stop_reason ?? 'end_turn';
        // usage 累计跨 message_start（prompt）+ message_delta（completion），随结束事件产出
        event.usage = { ...usage };
        return event;
      }
      default:
        return undefined; // ping / message_stop / error 忽略
    }
  }

  /** 429/5xx 指数退避重试；AbortError 不重试 */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ApiError(`请求中止: ${String(err)}`);
        }
        if (attempt < this.maxRetries) {
          attempt += 1;
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ApiError(`请求失败: ${String(err)}`);
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new ApiError(`provider 请求失败: ${res.status} ${res.statusText}`, res.status, body);
        }
        return res;
      }
      attempt += 1;
      await sleep(backoffMs(attempt));
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 500, 15_000) + Math.random() * 200;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 单次 read 带空闲超时（停滞才中止；数据到达自动续期） */
function readWithIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  onStall: () => void,
): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onStall();
      reject(new Error(`provider 响应停滞（${timeoutMs}ms 无数据）`));
    }, timeoutMs);
    timer.unref?.();
    reader.read().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
