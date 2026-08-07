import { describe, expect, it } from 'vitest';
import { costText, type UsageStats } from './tui.js';

const usage: UsageStats = { promptTokens: 1_000_000, completionTokens: 1_000_000, cacheReadTokens: 1_000_000, cost: 0 };

describe('costText（/cost，M3 完善前的估算）', () => {
  it('deepseek-chat 成本换算', () => {
    // 1M input×0.27 + 1M output×1.1 + 1M cache×0.07 = 1.44
    const t = costText('deepseek-chat', usage);
    expect(t).toContain('deepseek-chat');
    expect(t).toContain('$1.4400');
  });

  it('未知模型成本按 0 计', () => {
    const t = costText('unknown-model', usage);
    expect(t).toContain('$0.0000');
  });
});
