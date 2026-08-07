import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandInput } from './expand.js';

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-expand-'));
  await fs.writeFile(path.join(tmp, 'a.txt'), 'hello world', 'utf8');
  await fs.writeFile(path.join(tmp, '中文.txt'), '中文内容', 'utf8');
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('expandInput（todos M1-S5 P1：@文件 / !命令）', () => {
  it('@path 注入文件内容（验收：@a.txt 你好 → 模型看得到 a 内容）', async () => {
    const out = await expandInput('@a.txt 你好', tmp);
    expect(out).toContain('[文件 a.txt]');
    expect(out).toContain('hello world');
    expect(out).toContain('你好');
  });

  it('中文路径 @ 引用可用', async () => {
    const out = await expandInput('读 @中文.txt', tmp);
    expect(out).toContain('中文内容');
  });

  it('!cmd 注入命令输出', async () => {
    const out = await expandInput('!echo hi', tmp);
    expect(out).toContain('[命令 echo hi');
    expect(out).toContain('hi');
    expect(out).toContain('exit=0');
  });

  it('文件不存在：错误信息内联，不抛异常', async () => {
    const out = await expandInput('@nope.txt', tmp);
    expect(out).toContain('文件不存在');
  });

  it('路径逃逸：拒绝并内联错误', async () => {
    const out = await expandInput('@../evil.txt', tmp);
    expect(out).toContain('逃逸');
  });

  it('重叠保护：!echo @a.txt 里 @ 被命令文本吞掉，不单独展开', async () => {
    const out = await expandInput('!echo @a.txt', tmp);
    expect(out).toContain('[命令 echo @a.txt');
    expect(out).not.toContain('[文件 a.txt]');
  });

  it('无 @/! 原样返回', async () => {
    expect(await expandInput('普通问题', tmp)).toBe('普通问题');
  });
});
