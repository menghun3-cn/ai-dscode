import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleSystemPrompt } from './prompt.js';
import { readTool } from '../tools/read.js';

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-prompt-'));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('assembleSystemPrompt（todos M1-S4）', () => {
  it('含默认角色与工具 snippets', async () => {
    const prompt = await assembleSystemPrompt({ tools: [readTool], cwd: tmp });
    expect(prompt).toContain('dscode');
    expect(prompt).toContain('read');
  });

  it('DSCODE.md 内容注入（若存在）', async () => {
    await fs.writeFile(path.join(tmp, 'DSCODE.md'), '本项目用 pnpm', 'utf8');
    const prompt = await assembleSystemPrompt({ tools: [], cwd: tmp });
    expect(prompt).toContain('本项目用 pnpm');
  });

  it('steering 文件按序注入', async () => {
    const steeringDir = path.join(tmp, '.dscode', 'steering');
    await fs.mkdir(steeringDir, { recursive: true });
    await fs.writeFile(path.join(steeringDir, 'a-format.md'), '格式化规则', 'utf8');
    await fs.writeFile(path.join(steeringDir, 'b-lint.md'), 'lint 规则', 'utf8');
    const prompt = await assembleSystemPrompt({ tools: [], cwd: tmp });
    expect(prompt.indexOf('格式化规则')).toBeLessThan(prompt.indexOf('lint 规则'));
  });

  it('extra 追加在末尾', async () => {
    const prompt = await assembleSystemPrompt({ tools: [], cwd: tmp, extra: '重点关注安全' });
    expect(prompt.trimEnd().endsWith('重点关注安全')).toBe(true);
  });

  it('无 DSCODE.md / steering 不报错', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-prompt-empty-'));
    const prompt = await assembleSystemPrompt({ tools: [], cwd: empty });
    expect(prompt.length).toBeGreaterThan(0);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
