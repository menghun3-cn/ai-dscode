import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bashTool, runCommand, BASH_OUTPUT_LIMIT } from './bash.js';

let tmp: string;
const ctx = { cwd: '' } as { cwd: string };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-bash-'));
  ctx.cwd = tmp;
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('bash 工具（SC-1.6）', () => {
  it('执行命令并返回 stdout', async () => {
    const r = await bashTool.execute('1', { command: 'echo hello' }, ctx);
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('hello');
    expect((r.metadata as { exitCode: number }).exitCode).toBe(0);
  });

  it('非零退出码标记 isError', async () => {
    const r = await bashTool.execute('1', { command: 'exit 3' }, ctx);
    expect(r.isError).toBe(true);
    expect((r.metadata as { exitCode: number }).exitCode).toBe(3);
  });

  it('cwd 生效', async () => {
    await fs.writeFile(path.join(tmp, 'mark.txt'), 'x', 'utf8');
    const r = await bashTool.execute('1', { command: 'ls mark.txt' }, ctx);
    expect(r.output).toContain('mark.txt');
  });

  it('sleep 100 配 timeout 能被中断', async () => {
    const start = Date.now();
    const r = await bashTool.execute('1', { command: 'sleep 100', timeout: 1000 }, ctx);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
    expect((r.metadata as { timedOut: boolean }).timedOut).toBe(true);
    expect(r.isError).toBe(true);
  });

  it('输出截断 50KB', async () => {
    const result = await runCommand('node -e "process.stdout.write(\'a\'.repeat(200000))"', tmp, 30_000);
    expect(result.stdout.length).toBeLessThanOrEqual(BASH_OUTPUT_LIMIT);
    expect(result.truncated).toBe(true);
  });
});
