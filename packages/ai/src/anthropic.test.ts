import { describe, expect, it } from 'vitest';
import { AnthropicClient } from './anthropic.js';
import type { FetchLike } from './client.js';

/** 构造 Anthropic SSE 响应体 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const ev = (json: string) => `event: x\ndata: ${json}\n\n`;

const client = (fetchImpl: FetchLike) =>
  new AnthropicClient({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', fetchImpl });

describe('AnthropicClient.streamChat（M3 协议适配）', () => {
  it('text_delta 流式解析为 content', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          ev('{"type":"message_start","message":{"usage":{"input_tokens":10}}}'),
          ev('{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}'),
          ev('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}'),
          ev('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}'),
          ev('{"type":"content_block_stop","index":0}'),
          ev('{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}'),
          ev('{"type":"message_stop"}'),
        ]),
      );
    const chunks: string[] = [];
    let finish: string | undefined;
    let usage: { prompt?: number; completion?: number } = {};
    for await (const e of client(fetchImpl).streamChat({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'hi' }] })) {
      if (e.content) chunks.push(e.content);
      if (e.finishReason) finish = e.finishReason;
      if (e.usage) usage = { prompt: e.usage.prompt_tokens, completion: e.usage.completion_tokens };
    }
    expect(chunks.join('')).toBe('Hello world');
    expect(finish).toBe('end_turn');
    expect(usage).toEqual({ prompt: 10, completion: 20 });
  });

  it('thinking_delta 解析为 reasoningContent（reasoning 展示，SC-3.2）', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          ev('{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}'),
          ev('{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"让我想想"}}'),
          ev('{"type":"content_block_stop","index":0}'),
          ev('{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}'),
          ev('{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"回答"}}'),
          ev('{"type":"message_stop"}'),
        ]),
      );
    const seen = { reasoning: '', content: '' };
    for await (const e of client(fetchImpl).streamChat({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'q' }] })) {
      if (e.reasoningContent) seen.reasoning += e.reasoningContent;
      if (e.content) seen.content += e.content;
    }
    expect(seen.reasoning).toBe('让我想想');
    expect(seen.content).toBe('回答');
  });

  it('tool_use 块解析为 toolCalls（partial_json 拼接）', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          ev('{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read"}}'),
          ev('{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}'),
          ev('{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"src/a.ts\\"}"}}'),
          ev('{"type":"content_block_stop","index":0}'),
          ev('{"type":"message_delta","delta":{"stop_reason":"tool_use"}}'),
          ev('{"type":"message_stop"}'),
        ]),
      );
    let toolCalls: { name: string; arguments: string }[] = [];
    for await (const e of client(fetchImpl).streamChat({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'read a file' }] })) {
      if (e.toolCalls) toolCalls = e.toolCalls.map((tc) => ({ name: tc.function.name, arguments: tc.function.arguments }));
    }
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('read');
    expect(JSON.parse(toolCalls[0]!.arguments)).toEqual({ path: 'src/a.ts' });
  });
});
