import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDebugLogger } from './logger.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-logger-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

/** 等待 logger 流 flush 后读对应 session 的日志（按 sessionId 前缀过滤，避免取错文件） */
async function flushAndRead(sessionId?: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 50));
  const dir = path.join(home, 'logs');
  const files = await fs.readdir(dir);
  const name = sessionId ? files.find((f) => f.includes(sessionId.slice(0, 8))) : files[0];
  if (!name) throw new Error(`日志文件不存在: ${sessionId}`);
  return fs.readFile(path.join(dir, name), 'utf8');
}

/** 取日志最后一行并解析 */
function lastLine(raw: string): Record<string, unknown> {
  const lines = raw.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

describe('createDebugLogger（横切项 P1：日志与可观测，NFR-4）', () => {
  it('debug=false 返回 null', () => {
    expect(createDebugLogger({ debug: false })).toBeNull();
  });

  it('debug=true 写 ~/.dscode/logs/ JSONL（含 ts/type/data）', async () => {
    const logger = createDebugLogger({ debug: true, sessionId: 'sess-log-12345678' });
    expect(logger).not.toBeNull();
    logger!.log({ type: 'agent_start', input: 'hi' } as never);
    logger!.log({ type: 'message_update', content: '你好' } as never);
    logger!.log({ type: 'agent_settled', reason: 'no-tool-calls', usage: { prompt_tokens: 10, completion_tokens: 5, cache_read_input_tokens: 3 } } as never);
    logger!.close();
    const raw = await flushAndRead('sess-log-12345678');
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const obj = JSON.parse(line) as { ts: number; type: string; data: Record<string, unknown> };
      expect(obj.ts).toBeTypeOf('number');
      expect(obj.type).toBeTypeOf('string');
      expect(obj.data).toBeTypeOf('object');
    }
  });

  it('agent_settled 含收敛原因 + usage（NFR-4 附加判据）', async () => {
    const logger = createDebugLogger({ debug: true, sessionId: 'sess-settle-001' });
    logger!.log({ type: 'agent_settled', reason: 'max-turns', usage: { prompt_tokens: 100, completion_tokens: 20, cache_read_input_tokens: 50 } } as never);
    logger!.close();
    const raw = await flushAndRead('sess-settle-001');
    const obj = lastLine(raw) as { data: { reason: string; usage: Record<string, number> } };
    expect(obj.data.reason).toBe('max-turns'); // 收敛原因
    expect(obj.data.usage.prompt_tokens).toBe(100); // 每轮 token
    expect(obj.data.usage.cache_read_input_tokens).toBe(50);
  });
});
