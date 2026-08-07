import { describe, expect, it, vi } from 'vitest';
import { handleSlash, type SlashCommandContext } from './commands.js';

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext & { model: string } {
  let model = 'deepseek-chat';
  const ctx: SlashCommandContext = {
    get model() {
      return model;
    },
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

  it('/exit 返回退出码 0', () => {
    const r = handleSlash('/exit', makeCtx());
    expect(r).toEqual({ handled: true, exitCode: 0 });
  });

  it('/help 列出命令', () => {
    const r = handleSlash('/help', makeCtx());
    expect(r.handled).toBe(true);
    expect(r.output).toContain('/exit');
    expect(r.output).toContain('/model');
  });

  it('/model 显示当前模型', () => {
    const r = handleSlash('/model', makeCtx());
    expect(r.output).toContain('deepseek-chat');
  });

  it('/model <id> 切换模型', () => {
    const ctx = makeCtx();
    const r = handleSlash('/model deepseek-reasoner', ctx);
    expect(ctx.setModel).toHaveBeenCalledWith('deepseek-reasoner');
    expect(r.output).toContain('deepseek-reasoner');
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
