/**
 * buildContextEntries（原理-session.md §4）：session → LLM 上下文。
 * - 只沿当前激活分支走（不在分支上的消息不进上下文）
 * - 遇 compaction → 摘要替代被切段；遇 branchSummary → 折叠为一行
 * - modelChange / label / extension → 跳过
 * session 是"完整历史"，这里是"LLM 视角"——两者分离，保证可审计且不淹没模型。
 */

import type { ChatMessage } from '@dscode/ai';
import type { SessionEntry } from './entries.js';

/** 沿 parentId 从 activeId 回溯到根，返回有序分支路径（根在前） */
export function branchPath(entries: SessionEntry[], activeId: string | null): SessionEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path: SessionEntry[] = [];
  let cur = activeId ? byId.get(activeId) : undefined;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** 把 session 树 + 激活节点折叠成 LLM 可见的消息序列 */
export function buildContextEntries(entries: SessionEntry[], activeId: string | null): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of branchPath(entries, activeId)) {
    switch (e.type) {
      case 'user':
        out.push({ role: 'user', content: e.content ?? '' });
        break;
      case 'assistant':
        out.push({ role: 'assistant', content: e.content ?? null, tool_calls: e.toolCalls });
        break;
      case 'toolResult':
        out.push({ role: 'tool', tool_call_id: e.toolCallId, content: e.content ?? '' });
        break;
      case 'compaction':
        out.push({ role: 'user', content: `[压缩摘要] ${e.content ?? ''}` });
        break;
      case 'branchSummary':
        out.push({ role: 'user', content: `[被放弃分支摘要] ${e.content ?? ''}` });
        break;
      default:
        // modelChange / label / extension：不进入 LLM 上下文
        break;
    }
  }
  return out;
}
