import { describe, expect, it } from 'vitest';
import { costText, fmtTokens, fmtDuration, statusText, type UsageStats } from './tui.js';

const usage: UsageStats = { promptTokens: 1_000_000, completionTokens: 1_000_000, cacheReadTokens: 1_000_000, cost: 0 };

describe('costText（/cost，M3 全 provider 计费 SC-3.3）', () => {
  it('deepseek-chat 成本换算', () => {
    // 1M input×0.27 + 1M output×1.1 + 1M cache×0.07 = 1.44
    const t = costText('deepseek-chat', usage);
    expect(t).toContain('deepseek-chat');
    expect(t).toContain('$1.4400');
  });

  it('openai gpt-4o 成本换算（跨 provider 目录取价）', () => {
    // 1M input×2.5 + 1M output×10 + 1M cache×1.25 = 13.75
    const t = costText('gpt-4o', usage);
    expect(t).toContain('gpt-4o');
    expect(t).toContain('$13.7500');
  });

  it('未知模型成本按 0 计', () => {
    const t = costText('unknown-model', usage);
    expect(t).toContain('$0.0000');
  });
});

describe('fmtTokens（轮次耗时旁显示）', () => {
  it('千以内原样', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(999)).toBe('999');
  });

  it('K / M 格式化', () => {
    expect(fmtTokens(11_660)).toBe('11.7K');
    expect(fmtTokens(1_200_000)).toBe('1.2M');
  });
});

describe('fmtDuration', () => {
  it('秒 / 分秒', () => {
    expect(fmtDuration(27_000)).toBe('27s');
    expect(fmtDuration(87_000)).toBe('1m 27s');
  });
});

describe('statusText（底部状态栏）', () => {
  it('模型 · 路径 · used/窗口 tok (占比)', () => {
    const t = statusText({ model: 'deepseek-v4-flash', cwd: '/proj/a', usedTokens: 518_800, contextWindow: 1_000_000 });
    expect(t).toBe('deepseek-v4-flash · /proj/a · 518.8K/1M tok (52%)');
  });

  it('contextWindow 为 0 时占比为 0 不除零', () => {
    const t = statusText({ model: 'm', cwd: '/', usedTokens: 100, contextWindow: 0 });
    expect(t).toContain('(0%)');
  });
});
