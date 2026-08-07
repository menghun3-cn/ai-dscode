import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { grepTool, grepFallback } from './grep.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-grep-'));
  ctx.cwd = tmp;
  await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'src', 'a.ts'), 'const token = "abc";\nconst other = 1;\n', 'utf8');
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('grep 工具（todos M1-S3，P0）', () => {
  it('正则命中返回 文件:行号:内容', async () => {
    const r = await grepTool.execute('1', { pattern: 'token' }, ctx);
    expect(r.output).toContain('src/a.ts:1');
    expect(r.output).toContain('token');
  });

  it('大小写不敏感（默认）', async () => {
    const r = await grepTool.execute('1', { pattern: 'TOKEN' }, ctx);
    expect(r.output).toContain('token');
  });

  it('无命中返回提示', async () => {
    const r = await grepTool.execute('1', { pattern: 'zzz_not_found' }, ctx);
    expect(r.output).toContain('无匹配');
  });

  it('内置 fallback 引擎可独立工作', async () => {
    const matches = await grepFallback(/token/, tmp, 100);
    expect(matches.length).toBe(1);
    // fallback 输出统一正斜杠（跨平台一致）
    expect(matches[0]!.file.endsWith('src/a.ts')).toBe(true);
    expect(matches[0]!.line).toBe(1);
  });
});
