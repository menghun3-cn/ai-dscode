import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillManager } from './skill.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-skill-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
  // 全局 skill
  await fs.mkdir(path.join(home, 'skills'), { recursive: true });
  await fs.writeFile(path.join(home, 'skills', 'lint.md'), '# Lint 规则\n- 使用 const\n- 禁止 any', 'utf8');
  // 项目 skill
  await fs.mkdir(path.join(tmp, 'proj', '.dscode', 'skills'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'proj', '.dscode', 'skills', 'test.md'), '测试规范：单测放同目录', 'utf8');
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('SkillManager（M4-S6：渐进披露）', () => {
  it('list 聚合全局 + 项目 skill', async () => {
    const mgr = new SkillManager({ cwd: path.join(tmp, 'proj') });
    const names = await mgr.list();
    expect(names).toContain('lint');
    expect(names).toContain('test');
  });

  it('load 读取内容；全局与项目都可命中', async () => {
    const mgr = new SkillManager({ cwd: path.join(tmp, 'proj') });
    const lint = await mgr.load('lint');
    expect(lint?.name).toBe('lint');
    expect(lint?.content).toContain('禁止 any');
    const test = await mgr.load('test');
    expect(test?.content).toContain('测试规范');
  });

  it('不存在的 skill 返回 null', async () => {
    const mgr = new SkillManager({ cwd: path.join(tmp, 'proj') });
    expect(await mgr.load('nope')).toBeNull();
  });

  it('防路径穿越：非法名字返回 null', async () => {
    const mgr = new SkillManager({ cwd: path.join(tmp, 'proj') });
    expect(await mgr.load('../secret')).toBeNull();
    expect(await mgr.load('a/b')).toBeNull();
  });
});
