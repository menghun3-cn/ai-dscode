import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveWithin, PathError } from './path.js';

describe('resolveWithin（路径保护，原理-file-tools.md §7）', () => {
  it('相对路径解析到 cwd 内', () => {
    expect(resolveWithin('/proj', 'src/a.ts')).toBe(path.resolve('/proj', 'src/a.ts'));
  });

  it('`..` 逃逸被拒绝', () => {
    expect(() => resolveWithin('/proj', '../etc/passwd')).toThrow(PathError);
    expect(() => resolveWithin('/proj/src', '../../outside')).toThrow(PathError);
  });

  it('指向 cwd 外的绝对路径被拒绝', () => {
    expect(() => resolveWithin('/proj', '/tmp/x')).toThrow(PathError);
  });

  it('cwd 内的绝对路径放行', () => {
    expect(resolveWithin('/proj', '/proj/a.ts')).toBe(path.resolve('/proj', 'a.ts'));
  });
});
