import { describe, expect, it } from 'vitest';
import { renderSessionMarkdown, renderSessionHtml } from './export.js';
import type { SessionEntry } from '@dscode/core';

function entry(partial: Partial<SessionEntry> & { id: string }): SessionEntry {
  return { parentId: null, type: 'user', timestamp: 1723000000000, ...partial } as SessionEntry;
}

const branch: SessionEntry[] = [
  entry({ id: 'u1', type: 'user', content: '你好' }),
  entry({ id: 'm1', parentId: 'u1', type: 'modelChange', name: 'deepseek-chat' }),
  entry({ id: 'a1', parentId: 'm1', type: 'assistant', content: '收到' }),
  entry({ id: 'l1', parentId: 'a1', type: 'label', name: '重构会话' }),
];

describe('renderSessionMarkdown（/export）', () => {
  it('含会话 ID、会话名、导出时间、节点数', () => {
    const md = renderSessionMarkdown({ sessionId: 'sess-abc', branch });
    expect(md).toContain('会话 ID: sess-abc');
    expect(md).toContain('会话名: 重构会话');
    expect(md).toContain('节点数: 4');
  });

  it('对话块含用户/助手/模型切换', () => {
    const md = renderSessionMarkdown({ sessionId: 'sess-abc', branch });
    expect(md).toContain('### 用户');
    expect(md).toContain('你好');
    expect(md).toContain('### 助手');
    expect(md).toContain('收到');
    expect(md).toContain('模型切换');
    expect(md).toContain('deepseek-chat');
  });
});

describe('renderSessionHtml（/export html）', () => {
  it('生成合法 HTML 骨架且转义内容', () => {
    const html = renderSessionHtml({ sessionId: 'sess-abc', branch });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('会话名: 重构会话');
    expect(html).toContain('你好');
  });

  it('HTML 转义特殊字符', () => {
    const evil = [entry({ id: 'u1', type: 'user', content: '<script>alert(1)</script>' })];
    const html = renderSessionHtml({ sessionId: 's', branch: evil });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
