/**
 * @dscode/ai — Provider 抽象层（架构文档 §4.2.4）
 *
 * 骨架阶段：仅导出包标识与占位类型。M1-S2 落地 Provider 接口、
 * OpenAI 兼容流式 client、DeepSeek provider、鉴权解析器、重试限流。
 */

export const AI_PACKAGE_VERSION = '0.1.0';

/** 占位类型：Provider 抽象将在 M1-S2 定义（架构文档 §4.2.4） */
export type ProviderPlaceholder = {
  id: string;
  api: 'openai-chat' | 'openai-responses' | 'anthropic-messages';
};
