/**
 * 共享类型：Chat 消息、工具调用、流式事件。
 * 协议层对齐 OpenAI Chat Completions（DeepSeek 兼容），见架构文档 §4.2.4。
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** function call：LLM 输出的"意图声明"（见 原理-agentloop.md §4） */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  /** assistant 消息可携带 tool_calls */
  tool_calls?: ToolCall[];
  /** tool 消息回传的调用 id */
  tool_call_id?: string;
  name?: string;
}

/** 工具 schema：typebox 兼容的 JSON Schema 形态，随 prompt 发给模型 */
export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** 流式事件：SSE 增量解析后的统一形态（见 原理-agentloop.md §5） */
export interface StreamEvent {
  content?: string;
  /** DeepSeek reasoner 的思考过程，与正文分离（架构文档 §10） */
  reasoningContent?: string;
  /** tool_calls 增量（按 index 累积后的当前状态） */
  toolCalls?: ToolCall[];
  usage?: StreamUsage;
  finishReason?: string | null;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}
