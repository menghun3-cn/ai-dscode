import { describe, expect, it } from 'vitest';
import { unifiedDiff } from './diff.js';

describe('unifiedDiff（原理-file-tools.md §6 对账审计）', () => {
  it('单行替换：-/+ 行 + 统计', () => {
    const d = unifiedDiff('foo bar', 'baz bar', { label: 'c.txt' });
    expect(d.text).toBe('--- a/c.txt\n+++ b/c.txt\n@@ -1 +1 @@\n-foo bar\n+baz bar');
    expect(d.stats).toEqual({ added: 1, removed: 1 });
  });

  it('局部行替换：保留上下文行', () => {
    const d = unifiedDiff('a\nb\nc', 'a\nx\nc');
    expect(d.text).toBe('--- a/file\n+++ b/file\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c');
    expect(d.stats).toEqual({ added: 1, removed: 1 });
  });

  it('新文件（oldText 为空）：@@ -0,0 +1,N @@', () => {
    const d = unifiedDiff('', 'x\ny');
    expect(d.text).toBe('--- a/file\n+++ b/file\n@@ -0,0 +1,2 @@\n+x\n+y');
    expect(d.stats).toEqual({ added: 2, removed: 0 });
  });

  it('内容相同：空 diff 与零统计', () => {
    const d = unifiedDiff('same\ncontent', 'same\ncontent');
    expect(d.text).toBe('');
    expect(d.stats).toEqual({ added: 0, removed: 0 });
  });

  it('CRLF 兼容：\r\n 与 \n 视作同一行分隔', () => {
    const d = unifiedDiff('a\r\nb\r\n', 'a\r\nx\r\n');
    expect(d.text).toContain('-b');
    expect(d.text).toContain('+x');
    expect(d.stats).toEqual({ added: 1, removed: 1 });
  });

  it('相邻改动合并为单 hunk（间距 ≤ 2×context）', () => {
    // 改 b→B 与 f→F，间隔 3 个上下文行，context=3 时合并为一个 hunk
    const d = unifiedDiff('a\nb\nc\nd\ne\nf', 'a\nB\nc\nd\ne\nF');
    expect(d.text).toContain('@@ -1,6 +1,6 @@');
    expect(d.stats).toEqual({ added: 2, removed: 2 });
  });

  it('大文件有界回退：超 LCS_LIMIT 不炸内存，统计仍正确', () => {
    const oldText = Array.from({ length: 1500 }, (_, i) => `o${i}`).join('\n');
    const newText = Array.from({ length: 1500 }, (_, i) => `n${i}`).join('\n');
    const d = unifiedDiff(oldText, newText); // 1500×1500=2.25M > 1M → 整段替换
    expect(d.stats).toEqual({ added: 1500, removed: 1500 });
    expect(d.text).toContain('@@ -1,1500 +1,1500 @@');
  });
});
