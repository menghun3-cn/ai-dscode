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
