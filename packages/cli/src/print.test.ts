import { describe, expect, it, vi, afterEach } from 'vitest';
import type { AgentEvent, AgentSession } from '@dscode/core';
import { runPrint, resolvePrintPrompt } from './print.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 让 readStdin 走 TTY 短路（立即返回空），避免测试挂死等 stdin */
function stubTTY(): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
}

/** mock session：只实现 run()，产出给定事件序列 */
function mockSession(events: AgentEvent[]): AgentSession {
  return {
    async *run() {
      for (const ev of events) yield ev;
    },
  } as unknown as AgentSession;
}

describe('runPrint（M1-S6：-p / 管道 / 退出码，SC-1.8）', () => {
  it('流式输出 message_update 到 stdout，退出码 0', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const session = mockSession([{ type: 'message_update', content: '你' }, { type: 'message_update', content: '好' }]);
    const code = await runPrint(session, '问好');
    expect(write).toHaveBeenCalledWith('你');
    expect(write).toHaveBeenCalledWith('好');
    expect(code).toBe(0);
  });

  it('工具失败 → 退出码 1（反映成败）', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const session = mockSession([
      { type: 'message_update', content: '遇到问题' },
      { type: 'tool_result', toolCallId: 'c1', toolName: 'bash', output: 'exit 1', isError: true },
    ]);
    const code = await runPrint(session, '跑命令');
    expect(code).toBe(1);
  });

  it('工具成功 → 退出码 0', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const session = mockSession([
      { type: 'tool_result', toolCallId: 'c1', toolName: 'read', output: 'ok', isError: false },
      { type: 'message_update', content: '完成' },
    ]);
    expect(await runPrint(session, '读文件')).toBe(0);
  });

  it('缺少 prompt 且无 stdin → 退出码 2', async () => {
    stubTTY();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const session = mockSession([]);
    const code = await runPrint(session, undefined, []);
    expect(code).toBe(2);
  });

  it('session.run 抛异常 → 退出码 1', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const session = {
      async *run() {
        throw new Error('连接失败');
      },
    } as unknown as AgentSession;
    expect(await runPrint(session, 'hi')).toBe(1);
  });
});

describe('resolvePrintPrompt（SC-1.8 管道解析）', () => {
  it('显式文本直接返回（不读 stdin）', async () => {
    expect(await resolvePrintPrompt('重构 auth', [])).toBe('重构 auth');
  });

  it('positionals 兜底', async () => {
    stubTTY();
    expect(await resolvePrintPrompt(undefined, ['总结', '代码'])).toBe('总结 代码');
  });

  it('空输入时 positionals 为空 → 返回空串', async () => {
    stubTTY();
    expect(await resolvePrintPrompt(undefined, [])).toBe('');
  });
});
