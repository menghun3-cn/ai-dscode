import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTool } from './read.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-read-'));
  ctx.cwd = tmp;
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('read 工具（SC-1.3）', () => {
  it('读取文件内容', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'hello', 'utf8');
    const r = await readTool.execute('1', { path: 'a.txt' }, ctx);
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('hello');
  });

  it('offset/limit 按行分片', async () => {
    await fs.writeFile(path.join(tmp, 'multi.txt'), ['l1', 'l2', 'l3', 'l4'].join('\n'), 'utf8');
    const r = await readTool.execute('1', { path: 'multi.txt', offset: 1, limit: 2 }, ctx);
    expect(r.output).toContain('l2');
    expect(r.output).toContain('l3');
    expect(r.output).not.toContain('l1');
    expect((r.metadata as { truncated: boolean }).truncated).toBe(true);
  });

  it('目录报错并提示', async () => {
    await fs.mkdir(path.join(tmp, 'adir'), { recursive: true });
    const r = await readTool.execute('1', { path: 'adir' }, ctx);
    expect(r.isError).toBe(true);
    expect(r.output).toContain('目录');
  });

  it('文件不存在报错', async () => {
    const r = await readTool.execute('1', { path: 'nope.txt' }, ctx);
    expect(r.isError).toBe(true);
  });

  it('路径逃逸被拒绝', async () => {
    const r = await readTool.execute('1', { path: '../secret.txt' }, ctx);
    expect(r.isError).toBe(true);
  });
});
