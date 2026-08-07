/**
 * 扩展事件类型（架构文档 §4.2.8 事件清单，M4 核心子集）。
 * handler 返回 { block: true, reason } 可拦截（如 tool_call block），
 * 或返回 undefined 放行。
 */

/** 事件名（核心子集，先于架构清单全量落地） */
export type ExtensionEventName =
  | 'before_agent_start'
  | 'agent_start'
  | 'agent_end'
  | 'agent_settled'
  | 'turn_start'
  | 'turn_end'
  | 'tool_call'
  | 'tool_result'
  | 'message_update'
  | 'model_select'
  | 'session_before_compact'
  | 'project_trust';

export interface ExtensionEventMap {
  before_agent_start: { input: string };
  agent_start: { input: string };
  agent_end: { reason: string };
  agent_settled: { reason: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  turn_start: { turn: number };
  turn_end: { turn: number };
  tool_call: { toolCallId: string; toolName: string; args: string };
  tool_result: { toolCallId: string; toolName: string; output: string; isError: boolean };
  message_update: { content: string };
  model_select: { model: string };
  session_before_compact: { tokensBefore: number };
  project_trust: { projectPath: string };
}

/** handler 返回值：block 拦截（可选 reason 给用户看） */
export interface ExtensionHandlerResult {
  block?: boolean;
  reason?: string;
}

export type ExtensionHandler<K extends ExtensionEventName> = (
  event: ExtensionEventMap[K],
) => void | ExtensionHandlerResult | Promise<void | ExtensionHandlerResult>;
