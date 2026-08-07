import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globTool } from './glob.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-glob-'));
  ctx.cwd = tmp;
  await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'src', 'a.ts'), '', 'utf8');
  await fs.writeFile(path.join(tmp, 'src', 'b.js'), '', 'utf8');
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('glob 工具（todos M1-S3）', () => {
  it('匹配 **/*.ts', async () => {
    const r = await globTool.execute('1', { pattern: '**/*.ts' }, ctx);
    expect(r.output).toContain('src/a.ts');
    expect(r.output).not.toContain('src/b.js');
  });

  it('无匹配返回提示', async () => {
    const r = await globTool.execute('1', { pattern: '**/*.rs' }, ctx);
    expect(r.output).toContain('无匹配');
  });
});
