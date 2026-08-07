import { describe, expect, it } from 'vitest';
import { OpenAIClient, ApiError, type FetchLike } from './client.js';

/** 构造 SSE 响应体（分段发送，模拟流式 chunk） */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const sseChunk = (json: string) => `data: ${json}\n\n`;

const client = (fetchImpl: FetchLike) =>
  new OpenAIClient({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', fetchImpl, maxRetries: 3 });

describe('OpenAIClient.streamChat', () => {
  it('mock SSE 解析出 content（todos M1-S2 验收）', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          sseChunk('{"choices":[{"delta":{"content":"Hello"},"index":0}]}'),
          sseChunk('{"choices":[{"delta":{"content":" world"},"index":0}]}'),
          sseChunk('{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}'),
          'data: [DONE]\n\n',
        ]),
      );
    const chunks: string[] = [];
    for await (const ev of client(fetchImpl).streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })) {
      if (ev.content) chunks.push(ev.content);
    }
    expect(chunks.join('')).toBe('Hello world');
  });

  it('mock SSE 解析出 tool_calls（含跨 chunk 分片拼接）', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          sseChunk('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":"}}]},"index":0}]}'),
          sseChunk('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"src/a.ts\\"}"}}]},"index":0}]}'),
          sseChunk('{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}'),
          'data: [DONE]\n\n',
        ]),
      );
    let toolCalls: { name: string; arguments: string }[] = [];
    for await (const ev of client(fetchImpl).streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'read a file' }] })) {
      if (ev.toolCalls) toolCalls = ev.toolCalls.map((tc) => ({ name: tc.function.name, arguments: tc.function.arguments }));
    }
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('read');
    expect(JSON.parse(toolCalls[0]!.arguments)).toEqual({ path: 'src/a.ts' });
  });

  it('reasoning_content 独立解析（reasoner）', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          sseChunk('{"choices":[{"delta":{"reasoning_content":"thinking..."},"index":0}]}'),
          sseChunk('{"choices":[{"delta":{"content":"answer"},"index":0}]}'),
          sseChunk('{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}'),
          'data: [DONE]\n\n',
        ]),
      );
    const seen = { reasoning: '', content: '' };
    for await (const ev of client(fetchImpl).streamChat({ model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'q' }] })) {
      if (ev.reasoningContent) seen.reasoning += ev.reasoningContent;
      if (ev.content) seen.content += ev.content;
    }
    expect(seen.reasoning).toBe('thinking...');
    expect(seen.content).toBe('answer');
  });

  it('[DONE] 后连接不关闭也能结束（回归：本地代理挂死）', async () => {
    // 模拟代理：发完 [DONE] 后保持连接不关（不 close controller）
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseChunk('{"choices":[{"delta":{"content":"ok"},"index":0}]}')));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        // 故意不 controller.close()：连接保持打开
      },
    });
    const fetchImpl: FetchLike = () => Promise.resolve(new Response(body, { status: 200 }));
    const chunks: string[] = [];
    // 给 read 循环一个总超时保护，防止回归后重新挂死
    const timer = setTimeout(() => {
      throw new Error('streamChat 未在 [DONE] 后结束');
    }, 5_000);
    try {
      for await (const ev of client(fetchImpl).streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })) {
        if (ev.content) chunks.push(ev.content);
      }
    } finally {
      clearTimeout(timer);
    }
    expect(chunks.join('')).toBe('ok');
  });
});

describe('OpenAIClient 重试与错误', () => {
  it('429 后指数退避重试成功（todos M1-S2 验收）', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(new Response(null, { status: 429 }));
      return Promise.resolve(sseResponse([sseChunk('{"choices":[{"delta":{"content":"ok"},"index":0}]}'), 'data: [DONE]\n\n']));
    };
    const chunks: string[] = [];
    for await (const ev of client(fetchImpl).streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })) {
      if (ev.content) chunks.push(ev.content);
    }
    expect(calls).toBe(2);
    expect(chunks.join('')).toBe('ok');
  });

  it('连续失败超上限抛 ApiError', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response(null, { status: 500 }));
    const c = new OpenAIClient({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', fetchImpl, maxRetries: 1 });
    await expect(async () => {
      for await (const _ of c.streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })) {
        // drain
      }
    }).rejects.toBeInstanceOf(ApiError);
  });
});

describe('空闲超时（回归：长输出不误杀）', () => {
  /** 按 intervalMs 逐个推送 chunk，总时长可远超 timeoutMs */
  function slowResponse(chunks: string[], intervalMs: number): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let i = 0;
        const timer = setInterval(() => {
          if (i < chunks.length) {
            controller.enqueue(encoder.encode(chunks[i]!));
            i += 1;
          } else {
            clearInterval(timer);
            controller.close();
          }
        }, intervalMs);
      },
    });
    return new Response(body, { status: 200 });
  }

  it('长流（数据持续到达）不中断——写长文档场景', async () => {
    // 每 30ms 一包、共 5 包（总时长约 150ms），timeoutMs=50（每包间隙 30 < 50）
    const payloads = ['a', 'b', 'c', 'd', 'e'].map((c) => sseChunk(`{"choices":[{"delta":{"content":"${c}"},"index":0}]}`));
    payloads.push('data: [DONE]\n\n');
    const fetchImpl: FetchLike = () => Promise.resolve(slowResponse(payloads, 30));
    const c = new OpenAIClient({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', fetchImpl, timeoutMs: 50 });
    const chunks: string[] = [];
    for await (const ev of c.streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })) {
      if (ev.content) chunks.push(ev.content);
    }
    expect(chunks.join('')).toBe('abcde'); // 未被总超时误杀
  });

  it('停滞（timeoutMs 内无任何数据）才中止', async () => {
    // 只发一包后不再发数据、也不关闭 → 50ms 无数据 → 中止
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseChunk('{"choices":[{"delta":{"content":"x"},"index":0}]}')));
        // 故意不 close、不再 enqueue → 停滞
      },
    });
    const fetchImpl: FetchLike = () => Promise.resolve(new Response(body, { status: 200 }));
    const c = new OpenAIClient({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', fetchImpl, timeoutMs: 50 });
    await expect(async () => {
      for await (const _ of c.streamChat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })) {
        // drain
      }
    }).rejects.toThrow(/停滞/);
  });
});
