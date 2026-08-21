import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editTool } from './edit.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-edit-'));
  ctx.cwd = tmp;
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function write(content: string): Promise<string> {
  const p = path.join(tmp, 'c.txt');
  await fs.writeFile(p, content, 'utf8');
  return p;
}

describe('edit 工具（SC-1.5）', () => {
  it('精确替换：foo → baz', async () => {
    await write('foo bar');
    const r = await editTool.execute('1', { path: 'c.txt', edits: [{ oldText: 'foo', newText: 'baz' }] }, ctx);
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(path.join(tmp, 'c.txt'), 'utf8')).toBe('baz bar');
  });

  it('成功后 metadata 携带 diff 快照与统计（原理-file-tools.md §6）', async () => {
    await write('foo bar');
    const r = await editTool.execute('1', { path: 'c.txt', edits: [{ oldText: 'foo', newText: 'baz' }] }, ctx);
    expect(r.metadata?.diff).toContain('-foo bar');
    expect(r.metadata?.diff).toContain('+baz bar');
    expect(r.metadata?.diffStats).toEqual({ added: 1, removed: 1 });
    expect(r.output).toContain('（+1 -1）');
  });

  it('一次多 disjoint edit', async () => {
    await write('aaa bbb ccc');
    const r = await editTool.execute('1', { path: 'c.txt', edits: [{ oldText: 'aaa', newText: '1' }, { oldText: 'ccc', newText: '3' }] }, ctx);
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(path.join(tmp, 'c.txt'), 'utf8')).toBe('1 bbb 3');
  });

  it('oldText 未命中报错', async () => {
    await write('abc');
    const r = await editTool.execute('1', { path: 'c.txt', edits: [{ oldText: 'zzz', newText: 'x' }] }, ctx);
    expect(r.isError).toBe(true);
    expect(r.output).toContain('未命中');
  });

  it('oldText 命中多次报错（非唯一）', async () => {
    await write('same same');
    const r = await editTool.execute('1', { path: 'c.txt', edits: [{ oldText: 'same', newText: 'x' }] }, ctx);
    expect(r.isError).toBe(true);
    expect(r.output).toContain('多次');
  });

  it('重叠 edit 报错', async () => {
    await write('abcdef');
    const r = await editTool.execute('1', { path: 'c.txt', edits: [{ oldText: 'abc', newText: 'X' }, { oldText: 'bcd', newText: 'Y' }] }, ctx);
    expect(r.isError).toBe(true);
    expect(r.output).toContain('重叠');
  });
});
