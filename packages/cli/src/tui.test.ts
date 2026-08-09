import { describe, expect, it } from 'vitest';
import { costText, fmtTokens, fmtDuration, statusText, renderStreamingText, resetCodeFence, shouldMergePaste, type UsageStats } from './tui.js';

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

describe('shouldMergePaste（P1 交互优化 A：粘贴折叠判定）', () => {
  it('窗口内连续行判定为粘贴', () => {
    expect(shouldMergePaste('第二行', 100, 180, 120)).toBe(true); // 80ms 内
    expect(shouldMergePaste('第二行', 100, 250, 120)).toBe(false); // 150ms 外
  });

  it('slash 命令不参与折叠', () => {
    expect(shouldMergePaste('/help', 100, 150, 120)).toBe(false);
  });
});

describe('renderStreamingText（P1 交互优化 C：代码块围栏着色）', () => {
  it('围栏内文本青色，围栏外原样', () => {
    resetCodeFence();
    const out = renderStreamingText('说明\n```ts\nconst a = 1\n```\n结束');
    expect(out).toContain('\x1b[36m```ts\x1b[0m'); // 块首语言标签
    expect(out).toContain('\x1b[36mconst a = 1\n\x1b[0m'); // 块内青色
    expect(out).toContain('\x1b[36m```\x1b[0m\n'); // 块尾闭合
    expect(out).toContain('结束'); // 围栏外原样
    expect(out.startsWith('说明')).toBe(true);
  });

  it('跨 chunk 保持围栏状态', () => {
    resetCodeFence();
    renderStreamingText('```js\ncode'); // 打开围栏未闭合
    const tail = renderStreamingText('更多\n```\n后文'); // 继续 + 闭合
    expect(tail).toContain('\x1b[36m更多\n\x1b[0m'); // 仍在围栏内
    expect(tail).toContain('后文'); // 闭合后原样
  });
});

describe('statusText（P1 交互优化 F：会话名/plan/busy）', () => {
  const base = { model: 'deepseek-v4-flash', cwd: '/proj', usedTokens: 1000, contextWindow: 65536 };

  it('含会话名 / plan / busy 标记', () => {
    const t = statusText({ ...base, name: '重构会话', planActive: true, busy: true });
    expect(t).toContain('「重构会话」');
    expect(t).toContain('[plan]');
    expect(t).toContain('⏳');
  });

  it('无增强字段时保持原格式', () => {
    const t = statusText(base);
    expect(t).toContain('deepseek-v4-flash');
    expect(t).toContain('1K/65.5K tok'); // fmtTokens(65536) = 65.5K
    expect(t).not.toContain('[plan]');
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
