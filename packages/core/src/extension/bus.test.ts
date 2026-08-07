import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './bus.js';

describe('EventBus（todos M4-S1）', () => {
  it('on/emit：handler 收到 payload', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('tool_call', handler);
    await bus.emit('tool_call', { toolCallId: 'c1', toolName: 'read', args: '{}' });
    expect(handler).toHaveBeenCalledWith({ toolCallId: 'c1', toolName: 'read', args: '{}' });
  });

  it('emit 返回 block 结果（扩展可拦截，SC 验收：订阅 tool_call 并 block）', async () => {
    const bus = new EventBus();
    bus.on('tool_call', async () => ({ block: true, reason: '用户拒绝' }));
    const result = await bus.emit('tool_call', { toolCallId: 'c1', toolName: 'bash', args: '{"command":"rm -rf /"}' });
    expect(result).toEqual({ block: true, reason: '用户拒绝' });
  });

  it('多个 handler 顺序执行，任一 block 即停', async () => {
    const bus = new EventBus();
    const first = vi.fn();
    const blocking = vi.fn(async () => ({ block: true }));
    const after = vi.fn();
    bus.on('tool_call', first);
    bus.on('tool_call', blocking);
    bus.on('tool_call', after);
    const result = await bus.emit('tool_call', { toolCallId: 'c1', toolName: 'x', args: '{}' });
    expect(first).toHaveBeenCalled();
    expect(blocking).toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled(); // 被 block 截断
    expect(result?.block).toBe(true);
  });

  it('unsubscribe 后不再收到', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('agent_start', handler);
    await bus.emit('agent_start', { input: 'hi' });
    off();
    await bus.emit('agent_start', { input: 'hi2' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('has：是否有订阅者', () => {
    const bus = new EventBus();
    expect(bus.has('tool_call')).toBe(false);
    bus.on('tool_call', () => {});
    expect(bus.has('tool_call')).toBe(true);
  });
});
