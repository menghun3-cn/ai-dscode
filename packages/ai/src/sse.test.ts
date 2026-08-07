import { describe, expect, it } from 'vitest';
import { SSEParser } from './sse.js';

describe('SSEParser', () => {
  it('解析单个事件', () => {
    const parser = new SSEParser();
    const events = parser.push('data: {"a":1}\n\n');
    expect(events).toEqual([{ a: 1 }]);
    expect(parser.isDone).toBe(false);
  });

  it('[DONE] 终止', () => {
    const parser = new SSEParser();
    parser.push('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(parser.isDone).toBe(true);
  });

  it('跨 chunk 拼接事件', () => {
    const parser = new SSEParser();
    expect(parser.push('data: {"a":')).toEqual([]);
    expect(parser.push('1}\n\ndata: {"b":2}\n\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('忽略坏行不崩', () => {
    const parser = new SSEParser();
    const events = parser.push('not-ss\n\ndata: {"ok":true}\n\n');
    expect(events).toEqual([{ ok: true }]);
  });
});
