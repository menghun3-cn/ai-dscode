import { describe, expect, it, vi } from 'vitest';
import { ExtensionApi } from './api.js';
import { EventBus } from './bus.js';

function makeApi(): ExtensionApi {
  return new ExtensionApi({ bus: new EventBus(), extensionId: 'test-ext' });
}

describe('ExtensionApi（todos M4-S2，SC-4.1）', () => {
  it('registerTool 后可取回', () => {
    const api = makeApi();
    api.registerTool({ name: 'greet', description: '打招呼', parameters: {}, execute: async () => ({ output: 'Hello, Alice!' }) });
    expect(api.getTools()).toHaveLength(1);
    expect(api.getTools()[0]!.name).toBe('greet');
  });

  it('重复注册同名工具报错', () => {
    const api = makeApi();
    api.registerTool({ name: 'greet', description: '', parameters: {}, execute: async () => ({ output: '' }) });
    expect(() => api.registerTool({ name: 'greet', description: '', parameters: {}, execute: async () => ({ output: '' }) })).toThrow(/已注册/);
  });

  it('registerCommand/Shortcut/Flag 可注册', () => {
    const api = makeApi();
    api.registerCommand({ name: 'hello', handler: () => 'world' });
    api.registerShortcut({ keys: 'ctrl+k', handler: () => {} });
    api.registerFlag({ name: '--my-flag', handler: () => {} });
    expect(api.getCommands().map((c) => c.name)).toContain('hello');
    expect(api.getShortcuts().map((s) => s.keys)).toContain('ctrl+k');
    expect(api.getFlags().map((f) => f.name)).toContain('--my-flag');
  });

  it('on 订阅经总线可达（扩展与内置同构）', async () => {
    const bus = new EventBus();
    const api = new ExtensionApi({ bus, extensionId: 'e' });
    const handler = vi.fn();
    api.on('model_select', handler);
    await bus.emit('model_select', { model: 'gpt-4o' });
    expect(handler).toHaveBeenCalledWith({ model: 'gpt-4o' });
  });

  it('ctx.ui 默认控制台实现存在', async () => {
    const api = makeApi();
    expect(typeof api.ui.confirm).toBe('function');
    expect(typeof api.ui.input).toBe('function');
    expect(typeof api.ui.select).toBe('function');
    expect(typeof api.ui.notify).toBe('function');
  });
});
