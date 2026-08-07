import { describe, expect, it } from 'vitest';
import { ProviderRegistry, type Provider } from './provider.js';

const fakeProvider: Provider = {
  id: 'test',
  api: 'openai-chat',
  baseUrl: 'https://example.com',
  apiKey: 'sk-test',
  models: [
    {
      id: 'test-model',
      name: 'Test Model',
      reasoning: false,
      contextWindow: 65536,
      maxTokens: 8192,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
      input: ['text'],
    },
  ],
};

describe('ProviderRegistry', () => {
  it('register 后可 getAll 取回', () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]!.id).toBe('test');
  });

  it('get 按 id 命中', () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider);
    expect(registry.get('test')?.api).toBe('openai-chat');
    expect(registry.get('nope')).toBeUndefined();
  });

  it('重复注册同一 id 报错', () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider);
    expect(() => registry.register(fakeProvider)).toThrow(/已注册/);
  });
});
