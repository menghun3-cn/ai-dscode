/**
 * DeepSeek provider（架构文档 §4.2.4、需求文档 FR-6.1）。
 * 一等公民：走 OpenAI 兼容协议，baseUrl 默认 https://api.deepseek.com
 * （可用 DSAPI_BASE_URL 覆盖，FR-1.3），key 用鉴权解析器惰性解析。
 */

import type { Provider, ModelDef } from './provider.js';
import { resolveApiKey } from './auth.js';

export const deepseekBaseUrl = 'https://api.deepseek.com';

/** 内置 DeepSeek 模型目录（价格需与官方定价同步，供 /cost 计费） */
export const deepseekModels: ModelDef[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    reasoning: true,
    contextWindow: 65536,
    maxTokens: 8192,
    cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
    input: ['text'],
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    reasoning: false,
    contextWindow: 65536,
    maxTokens: 8192,
    cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
    input: ['text'],
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    reasoning: true,
    contextWindow: 65536,
    maxTokens: 8192,
    cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
    input: ['text'],
  },
];

export const deepseekProvider: Provider = {
  id: 'deepseek',
  api: 'openai-chat',
  baseUrl: deepseekBaseUrl,
  // 惰性解析：--api-key > auth.json > env（见 auth.ts）
  apiKey: async () => {
    const resolved = await resolveApiKey();
    if (!resolved) {
      throw new Error('未找到 DeepSeek API key：请配置 --api-key、auth.json 或 DSCODE_API_KEY');
    }
    return resolved.key;
  },
  models: deepseekModels,
};
