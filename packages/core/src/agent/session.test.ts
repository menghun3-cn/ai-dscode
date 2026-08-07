import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StreamEvent, ToolCall } from '@dscode/ai';
import { AgentSession, type ChatStreamer } from './session.js';
import { AgentSessionRuntime } from './runtime.js';
import { ToolRegistry } from '../tool.js';
import { readTool } from '../tools/read.js';
import { createBuiltinRegistry } from '../tools/index.js';
import { EventBus } from '../extension/bus.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-agent-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home; // 持久化落到临时目录，测试互不污染
  await fs.writeFile(path.join(tmp, 'a.txt'), 'hello', 'utf8');
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
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
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'no-tool-calls', usage: {} });
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
    // tool_call 事件必须先于 tool_result 发出（事件设计见 events.ts / 原理-agentloop.md §8）
    const calls = events.filter((e) => e.type === 'tool_call');
    expect(calls).toHaveLength(1);
    expect((calls[0] as { toolName: string }).toolName).toBe('read');
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { output: string }).output).toContain('hello');
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'no-tool-calls', usage: {} });
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

  it('agent_settled 携带累计 usage（多轮 token 求和）', async () => {
    // 第一轮：tool_call（usage 100/10），第二轮：纯内容（usage 50/5）→ 累计 150/15
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([
        [{ toolCalls: [readToolCall], finishReason: 'tool_calls', usage: { prompt_tokens: 100, completion_tokens: 10 } }],
        [{ content: '完成', usage: { prompt_tokens: 50, completion_tokens: 5 } }],
      ]),
    });
    let settledUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    for await (const ev of session.run('x')) {
      if (ev.type === 'agent_settled') settledUsage = ev.usage;
    }
    expect(settledUsage?.prompt_tokens).toBe(150);
    expect(settledUsage?.completion_tokens).toBe(15);
  });

  it('cache_read_input_tokens 跨轮累计（M3 P2 prompt cache）', async () => {
    // 第二轮起命中 prompt cache：第一轮 cache_read=0，第二轮 cache_read=80
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([
        [{ toolCalls: [readToolCall], finishReason: 'tool_calls', usage: { prompt_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 } }],
        [{ content: '完成', usage: { prompt_tokens: 100, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } }],
      ]),
    });
    let settledUsage: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
    for await (const ev of session.run('x')) {
      if (ev.type === 'agent_settled') settledUsage = ev.usage;
    }
    expect(settledUsage?.cache_read_input_tokens).toBe(80); // 命中累计
    expect(settledUsage?.cache_creation_input_tokens).toBe(100); // 创建累计
  });

  it('无 usage 事件时 agent_settled.usage 为空对象', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('hi')]) });
    let settledUsage: unknown;
    for await (const ev of session.run('x')) {
      if (ev.type === 'agent_settled') settledUsage = ev.usage;
    }
    expect(settledUsage).toEqual({});
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
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'max-turns', usage: {} });
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

  it('abort 后再次 run 可正常对话（新 AbortController，不被上一次中止污染）', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('你好')]) });
    // 第一轮被中止（Ctrl+C 场景）
    session.abort();
    // 第二轮应正常走完，而不是立刻 agent_settled aborted
    const events = [];
    for await (const ev of session.run('继续')) events.push(ev);
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'no-tool-calls', usage: {} });
    expect(events.filter((e) => e.type === 'message_update')).toHaveLength(1);
  });

  it('自动落盘：一轮对话后生成 .jsonl，每行可 parse（SC-2.1）', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('你好')]) });
    for await (const _ of session.run('第一轮')) {
      // drain
    }
    const file = path.join(home, 'sessions', (await import('../session/manager.js')).hashCwd(tmp), `${session.sessionId}.jsonl`);
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(2); // user + assistant
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('resume：同 sessionId 新建 AgentSession 能恢复历史（SC-2.2）', async () => {
    const first = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('你好')]) });
    for await (const _ of first.run('记住密码是 s3cr3t')) {
      // drain
    }
    // 用同一 sessionId 恢复
    const resumed = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('恢复成功')]), sessionId: first.sessionId });
    await resumed.prepare();
    // 历史应被加载进 messages（含第一轮的 user/assistant）
    expect(resumed.messages.map((m) => m.role)).toContain('user');
    expect(resumed.messages.some((m) => m.role === 'user' && m.content === '记住密码是 s3cr3t')).toBe(true);
    // 继续一轮后仍可正常收敛
    const events = [];
    for await (const ev of resumed.run('继续')) events.push(ev);
    expect(events.at(-1)?.type).toBe('agent_settled');
  });

  it('扩展工具回退：内置未命中时执行扩展工具（M4，SC-4.1）', async () => {
    const extTools = [
      {
        name: 'greet',
        description: '打招呼',
        parameters: {},
        execute: async (p: { name?: string }) => ({ output: `Hello, ${p.name ?? 'world'}!` }),
      },
    ];
    const greetCall: ToolCall = { id: 'c1', type: 'function', function: { name: 'greet', arguments: '{"name":"Alice"}' } };
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([[{ toolCalls: [greetCall], finishReason: 'tool_calls' }], contentTurn('完成')]),
      extTools,
    });
    const events = [];
    for await (const ev of session.run('打招呼')) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result') as { isError: boolean; output: string };
    expect(result.isError).toBe(false);
    expect(result.output).toBe('Hello, Alice!');
  });

  it('tool_call 事件可被扩展 block（验收：订阅 tool_call 并 block）', async () => {
    const bus = new EventBus();
    bus.on('tool_call', async (e) => (e.toolName === 'bash' ? { block: true, reason: '扩展禁止 bash' } : undefined));
    const bashCall: ToolCall = { id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command":"rm -rf /"}' } };
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([[{ toolCalls: [bashCall], finishReason: 'tool_calls' }], contentTurn('完成')]),
      bus,
    });
    const events = [];
    for await (const ev of session.run('跑命令')) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result') as { isError: boolean; output: string };
    expect(result.isError).toBe(true);
    expect(result.output).toContain('[blocked] 扩展禁止 bash');
  });

  it('applySkill 注入 system prompt（M4-S6：/skill:<name> 渐进披露）', async () => {
    // 造一个全局 skill
    await fs.mkdir(path.join(home, 'skills'), { recursive: true });
    await fs.writeFile(path.join(home, 'skills', 'lint.md'), '# Lint 规则\n- 使用 const', 'utf8');
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('ok')]) });
    await session.prepare();
    expect(await session.applySkill('lint')).toBe(true);
    expect(await session.applySkill('nope')).toBe(false);
    // 下一轮 LLM 调用应带上 skill 指令
    const events = [];
    for await (const ev of session.run('跑代码')) events.push(ev);
    expect(events.some((e) => e.type === 'agent_settled')).toBe(true);
  });

  it('/tree 语义：jumpTo 迁移激活分支，buildContextEntries 跟随（SC-2.3）', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('a'), contentTurn('b')]) });
    for await (const _ of session.run('第一问')) {
      // drain
    }
    const u1 = session.entries.find((e) => e.type === 'user')!;
    // 跳到第一个 user 节点（模拟 /tree 1）
    expect(session.jumpTo(u1.id)).toBe(true);
    // 激活分支从根到 u1，不含后续 assistant
    expect(session.activeBranch.map((e) => e.id)).toEqual([u1.id]);
    // 非法节点跳转失败
    expect(session.jumpTo('nope')).toBe(false);
  });

  it('跨 provider 切换：setModel 经 clientFactory 换 client（M3，SC-3.1）', async () => {
    const openaiClient: ChatStreamer = {
      async *streamChat() {
        yield { content: 'GPT 回答', finishReason: 'stop' };
      },
    };
    const deepseekClient: ChatStreamer = {
      async *streamChat() {
        yield { content: 'DeepSeek 回答', finishReason: 'stop' };
      },
    };
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: deepseekClient,
      // 模型属 openai 时返回 openai client，否则保持 deepseek
      clientFactory: (modelId) => (modelId.startsWith('gpt-') ? openaiClient : undefined),
    });
    // 默认 deepseek client
    let content = '';
    for await (const ev of session.run('q1')) {
      if (ev.type === 'message_update') content += ev.content;
    }
    expect(content).toBe('DeepSeek 回答');
    // 切到 gpt-4o（跨 provider）→ 换 client
    session.setModel('gpt-4o');
    content = '';
    for await (const ev of session.run('q2')) {
      if (ev.type === 'message_update') content += ev.content;
    }
    expect(content).toBe('GPT 回答');
  });

  it('Plan 模式写工具被拒（SC-4.4：/plan 只读）', async () => {
    const registry = new ToolRegistry();
    const { writeTool } = await import('../tools/write.js');
    registry.register(writeTool);
    const writeCall: ToolCall = { id: 'c1', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'a.txt', content: 'x' }) } };
    const session = new AgentSession({
      cwd: tmp,
      tools: registry,
      // 两轮 write 调用：第一轮 plan 拦截，第二轮（accept 后）放行
      client: scriptedClient([
        [{ toolCalls: [writeCall], finishReason: 'tool_calls' }],
        contentTurn('完成'),
        [{ toolCalls: [writeCall], finishReason: 'tool_calls' }],
        contentTurn('完成'),
      ]),
    });
    session.plan.enter(); // /plan
    const events = [];
    for await (const ev of session.run('改文件')) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result') as { isError: boolean; output: string };
    expect(result.isError).toBe(true);
    expect(result.output).toContain('[plan 只读]');
    // accept 后放行
    session.plan.accept();
    const events2 = [];
    for await (const ev of session.run('再改')) events2.push(ev);
    const result2 = events2.find((e) => e.type === 'tool_result') as { isError: boolean };
    expect(result2.isError).toBe(false);
  });

  it('危险命令二次确认拦截（SC-4.3：无确认回调默认拒绝）', async () => {
    const registry = new ToolRegistry();
    const { bashTool } = await import('../tools/bash.js');
    registry.register(bashTool);
    const dangerousCall: ToolCall = { id: 'c1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'rm -rf /tmp/x' }) } };
    const session = new AgentSession({
      cwd: tmp,
      tools: registry,
      client: scriptedClient([[{ toolCalls: [dangerousCall], finishReason: 'tool_calls' }], contentTurn('完成')]),
    });
    const events = [];
    for await (const ev of session.run('删东西')) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result') as { isError: boolean; output: string };
    expect(result.isError).toBe(true);
    expect(result.output).toContain('[权限拦截]');
  });

  it('sub-agent：task 工具隔离子会话执行并回传摘要（SC-4.5）', async () => {
    const taskCall: ToolCall = { id: 'c1', type: 'function', function: { name: 'task', arguments: JSON.stringify({ prompt: '收集 TODO 注释' }) } };
    // 轮次：主→task 调用；子会话消费一轮内容；主继续一轮收敛
    const session = new AgentSession({
      cwd: tmp,
      tools: createBuiltinRegistry(),
      client: scriptedClient([
        [{ toolCalls: [taskCall], finishReason: 'tool_calls' }],
        [{ content: '子 agent 收集到 3 处 TODO', finishReason: 'stop' }],
        [{ content: '主 agent 完成', finishReason: 'stop' }],
      ]),
    });
    const events = [];
    for await (const ev of session.run('派子任务')) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result' && (e as { toolName?: string }).toolName === 'task') as {
      isError: boolean;
      output: string;
    };
    expect(result.isError).toBe(false);
    expect(result.output).toContain('子 agent 收集到 3 处 TODO');
    expect(events.at(-1)).toEqual({ type: 'agent_settled', reason: 'no-tool-calls', usage: {} });
  });

  it('compact 手动压缩：写 compaction entry 并重建消息视图（SC-5.2）', async () => {
    // 摘要轮：scriptedClient 的第一轮内容作为摘要
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([
        [{ content: '- 目标：重构 auth', finishReason: 'stop' }],
        contentTurn('后续回答'),
      ]),
    });
    for await (const _ of session.run('第一问')) {
      // drain
    }
    for await (const _ of session.run('第二问')) {
      // drain
    }
    const before = session.messages.length; // 4 条
    const result = await session.compact('重点保留测试上下文', 2);
    expect(result).toContain('已压缩');
    expect(session.messages.length).toBeLessThan(before); // 视图收缩
    expect(session.messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('[压缩摘要]') });
    expect(session.entries.some((e) => e.type === 'compaction')).toBe(true); // compaction entry 落盘
  });

  it('自动压缩：估算 token 超阈值触发（SC-5.1）', async () => {
    const longTurn: StreamEvent[] = [
      {
        content: '回答'.repeat(6000), // 约 1.4 万 token，超过 keepRecentTokens 8000，可被切
        finishReason: 'stop',
      },
    ];
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([longTurn, [{ content: '短摘要', finishReason: 'stop' }], contentTurn('ok')]),
      compactThreshold: 2000, // 阈值很小，必触发
    });
    const events = [];
    for await (const ev of session.run('长对话')) events.push(ev);
    // 自动压缩后出现 compaction entry（摘要轮消费第二条）
    expect(session.entries.some((e) => e.type === 'compaction')).toBe(true);
    expect(events.some((e) => e.type === 'agent_settled')).toBe(true);
  });

  it('switchBranch：切分支时对被弃尾段写 branchSummary（M6）', async () => {
    const session = new AgentSession({ cwd: tmp, tools: registryWithRead(), client: scriptedClient([contentTurn('a'), contentTurn('b')]) });
    for await (const _ of session.run('第一问')) {
      // drain
    }
    const u1 = session.entries.find((e) => e.type === 'user')!;
    const msg = await session.switchBranch(u1.id); // 切回最早的 user 节点 → 弃掉后续尾段
    expect(msg).toContain('已切到节点');
    expect(session.entries.some((e) => e.type === 'branchSummary')).toBe(true); // 被弃分支摘要落盘
  });

  it('扩展自定义摘要：session_before_compact 返回 {block,reason} 覆盖 LLM 摘要（M6 P1）', async () => {
    const bus = new EventBus();
    bus.on('session_before_compact', async () => ({ block: true, reason: '扩展自定义摘要' }));
    const session = new AgentSession({
      cwd: tmp,
      tools: registryWithRead(),
      client: scriptedClient([contentTurn('a'), contentTurn('b'), contentTurn('c')]),
      bus,
    });
    for await (const _ of session.run('第一问')) {
      // drain
    }
    for await (const _ of session.run('第二问')) {
      // drain
    }
    const result = await session.compact();
    expect(result).toContain('扩展自定义摘要'); // 未调 LLM，直接用扩展摘要
  });
});
