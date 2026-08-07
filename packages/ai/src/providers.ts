/**
 * 内置 provider 集合（架构文档 §4.2.4、需求 FR-6）。
 * - openai：OpenAI Chat Completions（gpt-4o 系列）
 * - anthropic：Anthropic Messages（claude 系列）
 * - local：本地 OpenAI 兼容（Ollama / vLLM / LM Studio，baseUrl 可配）
 * 价格均为每百万 token USD（供 /cost 计费），需与官方定价同步。
 */

import type { Provider, ModelDef } from './provider.js';
import { deepseekProvider } from './deepseek.js';
import { resolveProviderApiKey } from './auth.js';
import { OpenAIClient } from './client.js';
import { AnthropicClient } from './anthropic.js';

// ---------- OpenAI ----------

const openaiModels: ModelDef[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 16384,
    cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
    input: ['text', 'image'],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 16384,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
    input: ['text', 'image'],
  },
];

export const openaiProvider: Provider = {
  id: 'openai',
  api: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: async () => (await resolveProviderApiKey('openai')) ?? '',
  models: openaiModels,
};

// ---------- Anthropic ----------

const anthropicModels: ModelDef[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    reasoning: false,
    contextWindow: 200000,
    maxTokens: 8192,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    input: ['text'],
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    reasoning: false,
    contextWindow: 200000,
    maxTokens: 8192,
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    input: ['text'],
  },
];

export const anthropicProvider: Provider = {
  id: 'anthropic',
  api: 'anthropic-messages',
  baseUrl: 'https://api.anthropic.com',
  apiKey: async () => (await resolveProviderApiKey('anthropic')) ?? '',
  models: anthropicModels,
};

// ---------- 本地 OpenAI 兼容（Ollama / vLLM / LM Studio） ----------

export interface LocalProviderOptions {
  /** 自定义 provider id（默认 local） */
  id?: string;
  /** baseUrl 覆盖（默认 DSCODE_LOCAL_BASE_URL env 或 http://localhost:11434/v1） */
  baseUrl?: string;
}

export function createLocalProvider(opts: LocalProviderOptions = {}): Provider {
  return {
    id: opts.id ?? 'local',
    api: 'openai-chat',
    baseUrl: opts.baseUrl ?? process.env['DSCODE_LOCAL_BASE_URL'] ?? 'http://localhost:11434/v1',
    apiKey: process.env['DSCODE_LOCAL_KEY'] ?? '',
    models: [
      {
        id: 'llama3.1',
        name: 'Llama 3.1 (local)',
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        input: ['text'],
      },
      {
        id: 'qwen2.5',
        name: 'Qwen 2.5 (local)',
        reasoning: false,
        contextWindow: 32768,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        input: ['text'],
      },
    ],
  };
}

// ---------- 装配 ----------

/** 默认 provider 列表（DeepSeek 优先，见架构文档 §4.2.4） */
export function createDefaultProviders(): Provider[] {
  return [deepseekProvider, openaiProvider, anthropicProvider, createLocalProvider()];
}

/** 按 provider 建 client（协议适配：anthropic-messages 用 AnthropicClient，其余走 OpenAI 兼容） */
export function createClientFor(provider: Provider, apiKey: string, timeoutMs?: number): OpenAIClient | AnthropicClient {
  const common = { baseUrl: provider.baseUrl, apiKey, timeoutMs };
  if (provider.api === 'anthropic-messages') return new AnthropicClient(common);
  return new OpenAIClient(common);
}
