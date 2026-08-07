import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StreamEvent, ToolCall } from '@dscode/ai';
import { AgentSession, type ChatStreamer } from './session.js';
import { AgentSessionRuntime } from './runtime.js';
import { ToolRegistry } from '../tool.js';
import { readTool } from '../tools/read.js';

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-agent-'));
  await fs.writeFile(path.join(tmp, 'a.txt'), 'hello', 'utf8');
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** 脚本化 LLM：每调一次 streamChat 吐下一轮事件（最后一轮重复） */
function scriptedClient(turns: StreamEvent[][]): ChatStreamer {
  let i = 0;
  return {
    async *streamChat() {
      const turn = turns[Math.min(i, turns.length - 1)] ?? [];
      i += 1;
      for (const ev of turn) yield ev;
    },
  };
}

const contentTurn = (content: string): StreamEvent[] => [{ content, finishReason: 'stop' }];

const readToolCall: ToolCall = {
  id: 'call_1',
  type: 'function',
  function: { name: 'read', arguments: JSON.stringify({ path: 'a.txt' }) },
};

function registryWithRead(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readTool);
  return registry;
}

describe('AgentSession（M1-S4）', () => {
  it('new + dispose 无异常（骨架验收）', () => {
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([contentTurn('hi')]),
    });
    session.dispose();
    expect(session.messages).toHaveLength(0);
  });

  it('AgentSessionRuntime.create 可创建并 dispose', () => {
    const session = AgentSessionRuntime.create({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([contentTurn('hi')]),
    });
    session.dispose();
  });

  it('无 tool_call 一轮收敛（agent_settled no-tool-calls）', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('你好')]) });
    const events = [];
    for await (const ev of session.run('问好')) events.push(ev);
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'no-tool-calls' });
    expect(events.filter((e) => e.type === 'message_update')).toHaveLength(1);
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('有 tool_call → 执行 → 回喂 → 再 LLM → 收敛（SC-1.7 形态）', async () => {
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([[{ toolCalls: [readToolCall], finishReason: 'tool_calls' }], contentTurn('文件内容是 hello')]),
    });
    const events = [];
    for await (const ev of session.run('读取 a.txt')) events.push(ev);
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { output: string }).output).toContain('hello');
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'no-tool-calls' });
    // messages: user + assistant(tool_calls) + tool + assistant(最终回答)
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('message_update 流式事件逐段产出', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([[{ content: '你' }, { content: '好' }]]) });
    const updates: string[] = [];
    for await (const ev of session.run('hi')) {
      if (ev.type === 'message_update') updates.push(ev.content);
    }
    expect(updates).toEqual(['你', '好']);
  });

  it('同轮多 tool_call 并行执行（时间上早于串行）', async () => {
    const delay = 250;
    const slowTool = {
      name: 'slow',
      description: '慢工具',
      parameters: { type: 'object', properties: {} },
      async execute() {
        await new Promise((r) => setTimeout(r, delay));
        return { output: 'done' };
      },
    };
    const registry = new ToolRegistry();
    registry.register(slowTool as never);
    const twoCalls: ToolCall[] = [1, 2].map((n) => ({
      id: `call_${n}`,
      type: 'function' as const,
      function: { name: 'slow', arguments: '{}' },
    }));
    const session = new AgentSession({
      cwd: tmp,
      tools: registry,
      client: scriptedClient([[{ toolCalls: twoCalls, finishReason: 'tool_calls' }], contentTurn('完成')]),
    });
    const start = Date.now();
    for await (const _ of session.run('并行跑')) {
      // drain
    }
    const elapsed = Date.now() - start;
    // 串行约 500ms，并行约 250ms；阈值取 400ms 判定并行
    expect(elapsed).toBeLessThan(400);
  });

  it('错误隔离：一个工具失败不连坐另一个', async () => {
    const boom = {
      name: 'boom',
      description: '抛异常工具',
      parameters: { type: 'object', properties: {} },
      async execute() {
        throw new Error('炸了');
      },
    };
    const registry = new ToolRegistry();
    registry.register(boom as never);
    registry.register(readTool);
    const calls: ToolCall[] = [
      { id: 'c1', type: 'function', function: { name: 'boom', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'a.txt' }) } },
    ];
    const session = new AgentSession({
      cwd: tmp,
      tools: registry,
      client: scriptedClient([[{ toolCalls: calls, finishReason: 'tool_calls' }], contentTurn('完成')]),
    });
    const events = [];
    for await (const ev of session.run('测试')) events.push(ev);
    const results = events.filter((e) => e.type === 'tool_result') as { toolName: string; isError: boolean }[];
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.toolName === 'boom')!.isError).toBe(true);
    expect(results.find((r) => r.toolName === 'read')!.isError).toBe(false);
  });

  it('达 maxTurns 上限强制收敛', async () => {
    const loopClient: ChatStreamer = {
      async *streamChat() {
        yield { toolCalls: [readToolCall], finishReason: 'tool_calls' };
      },
    };
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: loopClient, maxTurns: 3 });
    const events = [];
    for await (const ev of session.run('死循环')) events.push(ev);
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'max-turns' });
    // maxTurns=3：3 轮 LLM 均返回 tool_calls 并执行 → 3 个 tool_result 后被强制收敛
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(3);
  });

  it('非法 JSON 参数转为 isError 结果，不崩溃', async () => {
    const badCall: ToolCall = { id: 'c1', type: 'function', function: { name: 'read', arguments: '{not json' } };
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([[{ toolCalls: [badCall], finishReason: 'tool_calls' }], contentTurn('完成')]),
    });
    const events = [];
    for await (const ev of session.run('x')) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result') as { isError: boolean; output: string };
    expect(result.isError).toBe(true);
    expect(result.output).toContain('JSON');
  });
});
