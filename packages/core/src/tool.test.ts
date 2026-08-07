import { describe, expect, it } from 'vitest';
import { ToolRegistry, type Tool } from './tool.js';

const fakeTool: Tool = {
  name: 'test',
  description: 'test tool',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ output: 'ok' }),
};

describe('ToolRegistry（todos M1-S3 验收）', () => {
  it('注册 read 后 getAll() 含之', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    expect(registry.getAll().map((t) => t.name)).toContain('test');
    expect(registry.get('test')).toBe(fakeTool);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('重复注册同一工具名报错', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    expect(() => registry.register(fakeTool)).toThrow(/已注册/);
  });

  it('toOpenAITools 生成 OpenAI 兼容 schema', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    const tools = registry.toOpenAITools();
    expect(tools[0]).toEqual({
      type: 'function',
      function: { name: 'test', description: 'test tool', parameters: fakeTool.parameters },
    });
  });
});
