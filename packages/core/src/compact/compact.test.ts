import { describe, expect, it } from 'vitest';
import { estimateTokens, selectCutPoint, summarizeMessages, estimateMessagesTokens } from './compact.js';
import type { ChatMessage } from '@dscode/ai';
import type { ChatStreamer } from '../agent/session.js';

describe('estimateTokens（原理-compact.md §2.3 启发式）', () => {
  it('中文按 ~1.2 token/字、英文按 ~0.25 token/char', () => {
    expect(estimateTokens('你好')).toBeGreaterThan(1);
    expect(estimateTokens('hello world')).toBeGreaterThan(1);
    expect(estimateTokens('hello')).toBeLessThan(estimateTokens('你好'));
  });

  it('estimateMessagesTokens 累计', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(estimateMessagesTokens(msgs)).toBe(estimateTokens('{"role":"user","content":"你好"}') + estimateTokens('{"role":"assistant","content":"hello"}'));
  });
});

describe('selectCutPoint（保留最近 keepRecentTokens 估量）', () => {
  it('长消息序列：cutIndex 之前被切', () => {
    const msgs: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `消息${i}，内容够长能累计 token` }));
    const cut = selectCutPoint(msgs, 10);
    expect(cut.cutIndex).toBeGreaterThan(0);
    expect(cut.cutIndex).toBeLessThan(msgs.length);
  });

  it('不足阈值：全部保留（cutIndex=0）', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: '短' }];
    expect(selectCutPoint(msgs, 100_000).cutIndex).toBe(0);
  });
});

describe('summarizeMessages（一次 LLM 调用产结构化摘要）', () => {
  it('收集流式内容为摘要', async () => {
    const client: ChatStreamer = {
      async *streamChat() {
        yield { content: '- 目标：重构', finishReason: 'stop' };
      },
    };
    const summary = await summarizeMessages(client, [{ role: 'user', content: '旧消息' }], { model: 'deepseek-chat' });
    expect(summary).toContain('重构');
  });

  it('LLM 失败返回 null（调用方降级）', async () => {
    const client: ChatStreamer = {
      async *streamChat() {
        throw new Error('boom');
      },
    };
    expect(await summarizeMessages(client, [], { model: 'x' })).toBeNull();
  });
});
