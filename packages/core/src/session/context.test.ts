import { describe, expect, it } from 'vitest';
import { branchPath, buildContextEntries } from './context.js';
import type { SessionEntry } from './entries.js';

function entry(partial: Partial<SessionEntry> & { id: string }): SessionEntry {
  return { parentId: null, type: 'user', timestamp: 1, ...partial } as SessionEntry;
}

/** 构造线性链：u1 -> a1 -> t1 -> a2 */
function linearChain(): SessionEntry[] {
  return [
    entry({ id: 'u1', type: 'user', content: '你好' }),
    entry({ id: 'a1', parentId: 'u1', type: 'assistant', content: '收到' }),
    entry({ id: 't1', parentId: 'a1', type: 'toolResult', content: '输出', toolCallId: 'c1' }),
    entry({ id: 'a2', parentId: 't1', type: 'assistant', content: '完成' }),
  ];
}

describe('branchPath（沿 parentId 回溯）', () => {
  it('从末端回溯到根，根在前', () => {
    const path = branchPath(linearChain(), 'a2');
    expect(path.map((e) => e.id)).toEqual(['u1', 'a1', 't1', 'a2']);
  });

  it('从中间节点回溯只含该分支', () => {
    const path = branchPath(linearChain(), 'a1');
    expect(path.map((e) => e.id)).toEqual(['u1', 'a1']);
  });

  it('activeId 为空返回空', () => {
    expect(branchPath(linearChain(), null)).toEqual([]);
  });

  it('未知 activeId 返回空', () => {
    expect(branchPath(linearChain(), 'nope')).toEqual([]);
  });
});

describe('buildContextEntries（原理-session.md §4）', () => {
  it('线性链折叠为 ChatMessage 序列（SC-2.3 上下文重建）', () => {
    const msgs = buildContextEntries(linearChain(), 'a2');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(msgs[0]).toEqual({ role: 'user', content: '你好' });
    expect(msgs[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '输出' });
  });

  it('只含激活分支，分支外消息不进（tree 分支切换）', () => {
    const entries = [
      entry({ id: 'u1', type: 'user', content: 'A' }),
      entry({ id: 'a1', parentId: 'u1', type: 'assistant', content: '回答A' }),
      // 分叉：从 u1 出发的另一分支（不在激活路径）
      entry({ id: 'a2', parentId: 'u1', type: 'assistant', content: '回答B（另一分支）' }),
    ];
    const msgs = buildContextEntries(entries, 'a1');
    expect(msgs.map((m) => m.content)).toEqual(['A', '回答A']);
  });

  it('compaction entry 折叠为摘要 user 消息', () => {
    const entries = [
      entry({ id: 'c1', type: 'compaction', content: '早期对话摘要' }),
      entry({ id: 'u1', parentId: 'c1', type: 'user', content: '继续' }),
    ];
    const msgs = buildContextEntries(entries, 'u1');
    expect(msgs[0]).toEqual({ role: 'user', content: '[压缩摘要] 早期对话摘要' });
  });

  it('modelChange/label 不进上下文', () => {
    const entries = [
      entry({ id: 'u1', type: 'user', content: 'hi' }),
      entry({ id: 'm1', parentId: 'u1', type: 'modelChange', name: 'deepseek-chat' }),
      entry({ id: 'l1', parentId: 'm1', type: 'label', name: '重构会话' }),
      entry({ id: 'a1', parentId: 'l1', type: 'assistant', content: 'ok' }),
    ];
    const msgs = buildContextEntries(entries, 'a1');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
