import { describe, expect, it, vi } from 'vitest';
import { handleSlash, commandCompletions, resolveModelArg, cycleMenuIndex, type SlashCommandContext } from './commands.js';

const AVAILABLE = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext & { model: string } {
  let model = 'deepseek-chat';
  const ctx: SlashCommandContext = {
    get model() {
      return model;
    },
    availableModels: AVAILABLE,
    setModel: vi.fn((id) => {
      model = id;
    }),
    clearMessages: vi.fn(),
    costText: () => 'cost: $0.001',
    ...overrides,
  };
  return ctx as SlashCommandContext & { model: string };
}

describe('handleSlash（todos M1-S5 验收）', () => {
  it('非 slash 输入不处理', () => {
    const r = handleSlash('你好', makeCtx());
    expect(r.handled).toBe(false);
  });

  it('/exit 与 /quit 都返回退出码 0', () => {
    expect(handleSlash('/exit', makeCtx())).toEqual({ handled: true, exitCode: 0 });
    expect(handleSlash('/quit', makeCtx())).toEqual({ handled: true, exitCode: 0 });
  });

  it('/help 列出命令（含 /quit）', () => {
    const r = handleSlash('/help', makeCtx());
    expect(r.handled).toBe(true);
    expect(r.output).toContain('/exit');
    expect(r.output).toContain('/quit');
    expect(r.output).toContain('/model');
  });

  it('/model 列出可用模型（编号 + 当前标记）', () => {
    const r = handleSlash('/model', makeCtx());
    expect(r.output).toContain('当前模型: deepseek-chat');
    expect(r.output).toContain('1. deepseek-v4-flash');
    expect(r.output).toContain('2. deepseek-chat');
    expect(r.output).toContain('3. deepseek-reasoner');
  });

  it('/model <id> 切换模型', () => {
    const ctx = makeCtx();
    const r = handleSlash('/model deepseek-reasoner', ctx);
    expect(ctx.setModel).toHaveBeenCalledWith('deepseek-reasoner');
    expect(r.output).toContain('deepseek-reasoner');
  });

  it('/model <序号> 按编号切换', () => {
    const ctx = makeCtx();
    const r = handleSlash('/model 3', ctx);
    expect(ctx.setModel).toHaveBeenCalledWith('deepseek-reasoner');
    expect(r.output).toContain('deepseek-reasoner');
  });

  it('/model 无效编号提示未知模型', () => {
    const ctx = makeCtx();
    const r = handleSlash('/model 99', ctx);
    expect(ctx.setModel).not.toHaveBeenCalled();
    expect(r.output).toContain('未知模型');
  });

  it('/model 不在列表的 id 提示未知模型', () => {
    const ctx = makeCtx();
    const r = handleSlash('/model gpt-4o', ctx);
    expect(ctx.setModel).not.toHaveBeenCalled();
    expect(r.output).toContain('未知模型');
  });

  it('/cost 输出计费文本', () => {
    const r = handleSlash('/cost', makeCtx({ costText: () => 'cost: $0.01' }));
    expect(r.output).toContain('cost: $0.01');
  });

  it('/clear 清空会话', () => {
    const ctx = makeCtx();
    const r = handleSlash('/clear', ctx);
    expect(ctx.clearMessages).toHaveBeenCalled();
    expect(r.output).toContain('清空');
  });

  it('未知命令提示', () => {
    const r = handleSlash('/bogus', makeCtx());
    expect(r.output).toContain('未知命令');
  });
});

describe('resolveModelArg', () => {
  it('数字按 1-based 序号解析', () => {
    expect(resolveModelArg('1', AVAILABLE)).toBe('deepseek-v4-flash');
    expect(resolveModelArg('3', AVAILABLE)).toBe('deepseek-reasoner');
  });

  it('直接 id 命中返回自身', () => {
    expect(resolveModelArg('deepseek-chat', AVAILABLE)).toBe('deepseek-chat');
  });

  it('无效序号/id 返回 undefined', () => {
    expect(resolveModelArg('0', AVAILABLE)).toBeUndefined();
    expect(resolveModelArg('99', AVAILABLE)).toBeUndefined();
    expect(resolveModelArg('gpt-4o', AVAILABLE)).toBeUndefined();
  });
});

describe('commandCompletions（输入 / 后 Tab 提示）', () => {
  it('输入 / 提示全部命令', () => {
    const c = commandCompletions('/', AVAILABLE);
    expect(c).toContain('/exit');
    expect(c).toContain('/quit');
    expect(c).toContain('/model');
    expect(c.length).toBeGreaterThanOrEqual(6);
  });

  it('输入 /mo 提示 /model', () => {
    expect(commandCompletions('/mo', AVAILABLE)).toEqual(['/model']);
  });

  it('输入 /model <前缀> 提示模型（前缀匹配）', () => {
    // 三个模型都以 deepseek 开头，filter 保持 AVAILABLE 源顺序
    expect(commandCompletions('/model deep', AVAILABLE)).toEqual(AVAILABLE);
    expect(commandCompletions('/model deepseek-v4', AVAILABLE)).toEqual(['deepseek-v4-flash']);
    expect(commandCompletions('/model deepseek-ch', AVAILABLE)).toEqual(['deepseek-chat']);
    expect(commandCompletions('/model v4', AVAILABLE)).toEqual([]); // 非前缀不命中
  });

  it('普通文本无补全', () => {
    expect(commandCompletions('你好', AVAILABLE)).toEqual([]);
  });
});

describe('cycleMenuIndex（↑↓ 菜单选择，越界环绕）', () => {
  it('向下环绕', () => {
    expect(cycleMenuIndex(0, 1, 6)).toBe(1);
    expect(cycleMenuIndex(5, 1, 6)).toBe(0);
  });

  it('向上环绕', () => {
    expect(cycleMenuIndex(5, -1, 6)).toBe(4);
    expect(cycleMenuIndex(0, -1, 6)).toBe(5);
  });

  it('候选为空返回 0', () => {
    expect(cycleMenuIndex(0, 1, 0)).toBe(0);
    expect(cycleMenuIndex(3, -1, 0)).toBe(0);
  });
});
