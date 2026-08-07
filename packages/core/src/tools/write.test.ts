import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTool } from './write.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-write-'));
  ctx.cwd = tmp;
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('write 工具（SC-1.4）', () => {
  it('创建文件', async () => {
    const r = await writeTool.execute('1', { path: 'b.txt', content: 'world' }, ctx);
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(path.join(tmp, 'b.txt'), 'utf8')).toBe('world');
  });

  it('自动创建父目录', async () => {
    await writeTool.execute('1', { path: 'deep/nested/c.txt', content: 'x' }, ctx);
    expect(await fs.readFile(path.join(tmp, 'deep/nested/c.txt'), 'utf8')).toBe('x');
  });

  it('覆盖已存在文件', async () => {
    await fs.writeFile(path.join(tmp, 'ov.txt'), 'old', 'utf8');
    await writeTool.execute('1', { path: 'ov.txt', content: 'new' }, ctx);
    expect(await fs.readFile(path.join(tmp, 'ov.txt'), 'utf8')).toBe('new');
  });

  it('路径逃逸被拒绝', async () => {
    const r = await writeTool.execute('1', { path: '../evil.txt', content: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(fs.access(path.join(tmp, '..', 'evil.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(tmp, '..', 'evil.txt'))).rejects.toThrow();
  });
});
