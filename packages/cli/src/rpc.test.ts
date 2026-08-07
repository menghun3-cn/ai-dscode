import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PassThrough } from 'node:stream';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatStreamer, StreamEvent } from '@dscode/core';
import { AgentSession, ToolRegistry } from '@dscode/core';
import { runRpc } from './rpc.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-rpc-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeSession(): AgentSession {
  const client: ChatStreamer = {
    async *streamChat(): AsyncGenerator<StreamEvent> {
      yield { content: 'rpc 回复', finishReason: 'stop' };
    },
  };
  return new AgentSession({ cwd: tmp, tools: new ToolRegistry(), client });
}

/** 驱动 runRpc：写入请求，收集输出行（JSON-RPC 响应/通知） */
async function driveRpc(
  session: AgentSession,
  requests: Array<{ jsonrpc: string; id: number; method: string; params?: unknown }>,
): Promise<Array<Record<string, unknown>>> {
  const input = new PassThrough();
  const output = new PassThrough();
  const p = runRpc(session, { input, output });
  const lines: Array<Record<string, unknown>> = [];
  let buf = '';
  output.on('data', (b: Buffer) => {
    buf += b.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  for (const req of requests) input.write(`${JSON.stringify(req)}\n`);
  // 等待输出收敛
  await new Promise((r) => setTimeout(r, 100));
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'quit', params: {} })}\n`);
  await p;
  return lines;
}

describe('runRpc（todos M7：JSON-RPC over stdio 往返）', () => {
  it('ping → { pong: true }', async () => {
    const lines = await driveRpc(makeSession(), [{ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }]);
    expect(lines).toContainEqual({ jsonrpc: '2.0', id: 1, result: { pong: true } });
  });

  it('send → 事件流通知 + 回复文本（提问→回复往返）', async () => {
    const lines = await driveRpc(makeSession(), [{ jsonrpc: '2.0', id: 2, method: 'send', params: { prompt: '你好' } }]);
    // 事件通知（message_update）
    expect(lines.some((l) => l['method'] === 'event' && (l['params'] as { type: string }).type === 'message_update')).toBe(true);
    // 最终回复
    const sendResp = lines.find((l) => l['id'] === 2) as { result: { reply: string } };
    expect(sendResp.result.reply).toContain('rpc 回复');
  });

  it('未知方法 → JSON-RPC 错误 -32601', async () => {
    const lines = await driveRpc(makeSession(), [{ jsonrpc: '2.0', id: 3, method: 'bogus', params: {} }]);
    const err = lines.find((l) => l['id'] === 3) as { error: { code: number } };
    expect(err.error.code).toBe(-32601);
  });
});
