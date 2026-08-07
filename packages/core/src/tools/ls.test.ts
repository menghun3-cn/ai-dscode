import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lsTool } from './ls.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-ls-'));
  ctx.cwd = tmp;
  await fs.mkdir(path.join(tmp, 'sub'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'f.txt'), '', 'utf8');
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('ls 工具（todos M1-S3 [P1]）', () => {
  it('列目录：目录带 / 后缀', async () => {
    const r = await lsTool.execute('1', {}, ctx);
    expect(r.output).toContain('sub/');
    expect(r.output).toContain('f.txt');
  });

  it('目录不存在报错', async () => {
    const r = await lsTool.execute('1', { path: 'nope' }, ctx);
    expect(r.isError).toBe(true);
  });
});
