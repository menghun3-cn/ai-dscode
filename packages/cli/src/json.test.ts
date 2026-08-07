import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PassThrough } from 'node:stream';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatStreamer, StreamEvent } from '@dscode/core';
import { AgentSession, ToolRegistry } from '@dscode/core';
import { runJson } from './json.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-json-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeSession(turns: StreamEvent[][] = []): AgentSession {
  const client: ChatStreamer = {
    async *streamChat() {
      if (turns.length === 0) {
        yield { content: 'json 回复', finishReason: 'stop' };
        return;
      }
      for (const ev of turns.shift() ?? []) yield ev;
    },
  };
  return new AgentSession({ cwd: tmp, tools: new ToolRegistry(), client });
}

async function collectLines(session: AgentSession, prompt: string): Promise<Array<Record<string, unknown>>> {
  const output = new PassThrough();
  const p = runJson(session, prompt, [], { output });
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
  await p;
  return lines;
}

describe('runJson（todos M7-S3，SC-6.3）', () => {
  it('每行 JSON.parse 通过，含 type/data 字段（SC-6.3 通过判据）', async () => {
    const lines = await collectLines(makeSession(), '测试');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line['type']).toBeTypeOf('string');
      expect(line['data']).toBeTypeOf('object');
    }
  });

  it('事件流含 message_update / agent_start / agent_settled', async () => {
    const lines = await collectLines(makeSession(), '测试');
    const types = lines.map((l) => l['type']);
    expect(types).toContain('agent_start');
    expect(types).toContain('message_update');
    expect(types).toContain('agent_settled');
    const update = lines.find((l) => l['type'] === 'message_update') as { data: { content: string } };
    expect(update.data.content).toContain('json 回复');
  });

  it('缺少 prompt 返回 2', async () => {
    const orig = process.stdin.isTTY;
    // 模拟无管道输入的 TTY：readStdin 立即返回空（否则 vitest 里 stdin 管道永不开合会挂死）
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const output = new PassThrough();
      const code = await runJson(makeSession(), undefined, [], { output });
      expect(code).toBe(2);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: orig, configurable: true });
    }
  });
});
