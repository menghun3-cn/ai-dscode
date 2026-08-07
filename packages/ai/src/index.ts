/**
 * @dscode/ai — Provider 抽象层（架构文档 §4.2.4）
 *
 * M1-S2 已落地：Provider/ModelDef 类型、ProviderRegistry、
 * OpenAI 兼容 SSE 流式 client（重试/限流）、鉴权解析器、DeepSeek provider。
 */

export * from './types.js';
export * from './provider.js';
export * from './client.js';
export * from './sse.js';
export * from './auth.js';
export * from './deepseek.js';

export const AI_PACKAGE_VERSION = '0.1.1';
