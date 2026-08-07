/**
 * Session entry 类型（原理-session.md §2、架构文档 §4.2.3）。
 * 每行一个 entry，靠 parentId 连成树。完全对标 pi 的 session 格式。
 */

import type { StreamUsage, ToolCall } from '@dscode/ai';

export type SessionEntryType =
  | 'user'
  | 'assistant'
  | 'toolResult'
  | 'compaction'
  | 'branchSummary'
  | 'modelChange'
  | 'label'
  | 'extension';

export interface SessionEntry {
  id: string;
  /** 树节点：指向父 entry；根为 null */
  parentId: string | null;
  type: SessionEntryType;
  timestamp: number;
  role?: string;
  /** 允许 null（assistant 仅 tool_calls 时） */
  content?: string | null;
  /** assistant 消息可携带 tool_calls（LLM 视角重建用） */
  toolCalls?: ToolCall[];
  /** toolResult 回传的调用 id */
  toolCallId?: string;
  /** modelChange 的目标模型 / label 的名称 */
  name?: string;
  /** provider 返回的 usage（assistant 消息） */
  usage?: StreamUsage;
}

/** 生成 entry id（带前缀，便于人读） */
export function newEntryId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
