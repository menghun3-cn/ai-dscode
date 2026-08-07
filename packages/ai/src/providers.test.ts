import { describe, expect, it } from 'vitest';
import { createDefaultProviders, createClientFor, openaiProvider, anthropicProvider, createLocalProvider } from './providers.js';
import { AnthropicClient } from './anthropic.js';
import { OpenAIClient } from './client.js';

describe('内置 providers（M3，架构文档 §4.2.4）', () => {
  it('默认注册表含 deepseek/openai/anthropic/local', () => {
    const ids = createDefaultProviders().map((p) => p.id);
    expect(ids).toContain('deepseek');
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('local');
  });

  it('openai provider：openai-chat 协议 + gpt-4o 目录', () => {
    expect(openaiProvider.api).toBe('openai-chat');
    expect(openaiProvider.models.map((m) => m.id)).toContain('gpt-4o');
    expect(openaiProvider.baseUrl).toContain('api.openai.com');
  });

  it('anthropic provider：anthropic-messages 协议 + claude 目录', () => {
    expect(anthropicProvider.api).toBe('anthropic-messages');
    expect(anthropicProvider.models.some((m) => m.id.startsWith('claude'))).toBe(true);
  });

  it('local provider：默认 Ollama 地址，可自定义 baseUrl/id', () => {
    const local = createLocalProvider({ id: 'my-llm', baseUrl: 'http://localhost:8000/v1' });
    expect(local.id).toBe('my-llm');
    expect(local.baseUrl).toBe('http://localhost:8000/v1');
    expect(local.models.length).toBeGreaterThan(0);
  });
});

describe('createClientFor（协议适配分派）', () => {
  it('anthropic-messages → AnthropicClient', () => {
    const c = createClientFor(anthropicProvider, 'sk-ant');
    expect(c).toBeInstanceOf(AnthropicClient);
  });

  it('openai-chat（含 local）→ OpenAIClient', () => {
    expect(createClientFor(openaiProvider, 'sk-ok')).toBeInstanceOf(OpenAIClient);
    expect(createClientFor(createLocalProvider(), '')).toBeInstanceOf(OpenAIClient);
  });
});
