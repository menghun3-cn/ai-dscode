import { describe, expect, it } from 'vitest';
import { visibleWidth, cursorCol, truncateByWidth } from './width.js';

describe('visibleWidth（原理-tui.md §3：全角=2）', () => {
  it('半角按 1 计', () => {
    expect(visibleWidth('abc')).toBe(3);
    expect(visibleWidth('')).toBe(0);
  });

  it('全角中文按 2 计', () => {
    expect(visibleWidth('你好')).toBe(4);
    expect(visibleWidth('中文a')).toBe(5); // 2+2+1
  });

  it('混合文本', () => {
    expect(visibleWidth('a好b')).toBe(4); // 1+2+1
    expect(visibleWidth('！')).toBe(2); // 全角感叹号
  });

  it('不拆代理对（emoji 按 2 列计，现代终端行为）', () => {
    expect(visibleWidth('a😀b')).toBe(4); // 1+2+1
  });
});

describe('cursorCol', () => {
  it('等于前缀可见宽度（IME 定位用）', () => {
    expect(cursorCol('你好')).toBe(4);
    expect(cursorCol('ab')).toBe(2);
  });
});

describe('truncateByWidth', () => {
  it('按列宽截断，不在全角字符中间切断', () => {
    expect(truncateByWidth('abc你好', 3)).toBe('abc');
    expect(truncateByWidth('a好b', 3)).toBe('a好'); // 1+2=3
    expect(truncateByWidth('你好世界', 3)).toBe('你'); // 2+2=4 > 3
  });

  it('不拆代理对', () => {
    expect(truncateByWidth('a😀b', 3)).toBe('a😀');
  });

  it('maxWidth <= 0 返回空串', () => {
    expect(truncateByWidth('abc', 0)).toBe('');
    expect(truncateByWidth('abc', -1)).toBe('');
  });
});
