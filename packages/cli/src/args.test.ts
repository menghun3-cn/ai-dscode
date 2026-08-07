import { describe, expect, it } from 'vitest';
import { parseArgs, HELP_TEXT } from './args.js';

describe('HELP_TEXT（todos M1-S5 验收：--help 列出全部参数）', () => {
  it('包含全部参数与用法', () => {
    expect(HELP_TEXT).toContain('--print');
    expect(HELP_TEXT).toContain('--mode');
    expect(HELP_TEXT).toContain('--provider');
    expect(HELP_TEXT).toContain('--model');
    expect(HELP_TEXT).toContain('--api-key');
    expect(HELP_TEXT).toContain('--continue');
    expect(HELP_TEXT).toContain('--resume');
    expect(HELP_TEXT).toContain('--version');
    expect(HELP_TEXT).toContain('鉴权优先级');
  });
});

describe('parseArgs（todos M1-S5 验收）', () => {
  it('默认 interactive、deepseek、deepseek-v4-flash', () => {
    const args = parseArgs([]);
    expect(args.mode).toBeUndefined();
    expect(args.provider).toBe('deepseek');
    expect(args.model).toBe('deepseek-v4-flash');
    expect(args.help).toBe(false);
  });

  it('-p/--print 进入 print（带 prompt 文本）', () => {
    expect(parseArgs(['-p', '重构 auth 模块']).printPrompt).toBe('重构 auth 模块');
    expect(parseArgs(['--print', 'hi']).printPrompt).toBe('hi');
  });

  it('--mode / --provider / --model / --api-key 解析', () => {
    const args = parseArgs(['--mode', 'json', '--provider', 'openai', '--model', 'gpt-4o', '--api-key', 'sk-x']);
    expect(args.mode).toBe('json');
    expect(args.provider).toBe('openai');
    expect(args.model).toBe('gpt-4o');
    expect(args.apiKey).toBe('sk-x');
  });

  it('-c / -r / -h / -v 布尔标志', () => {
    expect(parseArgs(['-c']).cont).toBe(true);
    expect(parseArgs(['-r']).resume).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('位置参数保留', () => {
    expect(parseArgs(['hello', 'world']).positionals).toEqual(['hello', 'world']);
  });

  it('无效 --mode 抛错', () => {
    expect(() => parseArgs(['--mode', 'bogus'])).toThrow(/无效 --mode/);
  });
});
