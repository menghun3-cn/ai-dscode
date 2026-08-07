/**
 * OpenAI 兼容流式 client（架构文档 §4.2.4、原理-agentloop.md §5）。
 * - Chat Completions SSE 流式解析：content / tool_calls / reasoning_content
 * - 429/5xx 指数退避重试（默认 ≤3 次，可注入 fetch 便于测试）
 */

import type { ChatCompletionOptions, StreamEvent, ToolCall, StreamUsage } from './types.js';
import { SSEParser } from './sse.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface OpenAIClientOptions {
  baseUrl: string;
  /** 静态 key 或惰性解析（auth.json/env） */
  apiKey: string | (() => Promise<string>);
  /** 测试注入；默认全局 fetch */
  fetchImpl?: FetchLike;
  maxRetries?: number;
  timeoutMs?: number;
}

/** 同一 assistant message 的多个 tool_call 按 index 累积（见 原理-agentloop.md §5.2） */
interface ToolCallAcc extends ToolCall {
  index: number;
}

export class OpenAIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | (() => Promise<string>);
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(opts: OpenAIClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = resolveTimeoutMs(opts.timeoutMs);
  }

  private async resolveKey(): Promise<string> {
    return typeof this.apiKey === 'function' ? this.apiKey() : this.apiKey;
  }

  /** 429/5xx 指数退避重试（含 Retry-After 尊重） */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        // 网络层错误：可重试
        if (attempt < this.maxRetries) {
          attempt += 1;
          await sleep(this.backoffMs(attempt, undefined));
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
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(this.backoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined));
    }
  }

  private backoffMs(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000);
    const base = Math.min(2 ** attempt * 500, 15_000); // 500ms, 1s, 2s ...
    return base + Math.random() * 200; // jitter 防雷群
  }

  /** 流式 chat：逐事件产出 content / toolCalls / reasoningContent / usage */
  async *streamChat(opts: ChatCompletionOptions): AsyncGenerator<StreamEvent> {
    const key = await this.resolveKey();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    /** 空闲超时：单次 read 超 timeoutMs 无数据即中止。每包数据到达自动续期；
     *  真实 fetch 下同时 abort 断开连接，mock 流也能靠 reject 生效（不依赖 abort 接线）。 */
    const stallError = () => new Error(`provider 响应停滞（${this.timeoutMs}ms 无数据）`);

    // 连接/首包阶段同样有停滞兜底
    const connectTimer = setTimeout(() => controller.abort(stallError()), this.timeoutMs);
    connectTimer.unref?.();
    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
          ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          stream: true,
        }),
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
      if (!res.body) throw new ApiError('响应无 body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SSEParser();
      const toolAcc = new Map<number, ToolCallAcc>();
      /** 空闲超时：单次 read 超 timeoutMs 无数据即中止。每包数据到达自动续期；
       *  真实 fetch 下同时 abort 断开连接，mock 流也能靠 reject 生效（不依赖 abort 接线）。 */
      const readWithIdle = (): Promise<{ done: boolean; value?: Uint8Array }> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            controller.abort(stallError());
            reject(stallError());
          }, this.timeoutMs);
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
      for (;;) {
        const { done, value } = await readWithIdle();
        if (done) break;
        for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
          const event = this.parseChunk(ev, toolAcc);
          if (event) yield event;
        }
        // 已收到 [DONE]：流结束，不等连接关闭（部分代理发完 [DONE] 后保持连接不关）
        if (parser.isDone) break;
      }
      // 尾部残留（未遇 [DONE] 且无更多数据时冲刷）
      if (!parser.isDone) {
        for (const ev of parser.push(decoder.decode())) {
          const event = this.parseChunk(ev, toolAcc);
          if (event) yield event;
        }
      }
    } finally {
      clearTimeout(connectTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** 把单个 SSE chunk 解析成 StreamEvent；工具增量按 index 累积 */
  private parseChunk(raw: Record<string, unknown>, toolAcc: Map<number, ToolCallAcc>): StreamEvent | undefined {
    const event: StreamEvent = {};
    const choices = raw['choices'];
    if (Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0] as {
        delta?: { content?: string; reasoning_content?: string; tool_calls?: ToolCallAcc[] };
        finish_reason?: string | null;
      };
      const delta = choice.delta;
      if (delta?.content) event.content = delta.content;
      if (delta?.reasoning_content) event.reasoningContent = delta.reasoning_content;
      if (delta?.tool_calls) {
        const tcs: ToolCall[] = [];
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          const acc = toolAcc.get(index) ?? { index, id: tc.id ?? '', type: 'function' as const, function: { name: '', arguments: '' } };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.function.name += tc.function.name;
          if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
          toolAcc.set(index, acc);
          tcs.push({ id: acc.id, type: 'function', function: { ...acc.function } });
        }
        event.toolCalls = tcs;
      }
      if (choice.finish_reason) event.finishReason = choice.finish_reason;
    }
    const usage = raw['usage'] as StreamUsage | undefined;
    if (usage) event.usage = usage;
    return Object.keys(event).length > 0 ? event : undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 空闲超时时长：显式参数 > DSCODE_TIMEOUT_MS env（毫秒）> 默认 300s。
 * 该超时是"停滞兜底"——只在无任何数据时触发，长输出不受影响。
 */
function resolveTimeoutMs(explicit?: number): number {
  if (explicit !== undefined && explicit > 0) return explicit;
  const env = Number(process.env['DSCODE_TIMEOUT_MS']);
  return Number.isFinite(env) && env > 0 ? env : 300_000;
}
