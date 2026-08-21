import { describe, expect, it } from 'vitest';
import { visibleLen } from './tui-render.js';
import {
  costText,
  fmtTokens,
  fmtDuration,
  statusText,
  statusBarText,
  contextBar,
  shortenPath,
  titleBarText,
  renderStreamingText,
  renderDiffText,
  renderEventText,
  resetCodeFence,
  shouldMergePaste,
  type UsageStats,
} from './tui.js';

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

describe('titleBarText（① 顶部标题栏）', () => {
  it('含会话名 / [plan] / ⏳ 徽标', () => {
    const t = titleBarText({ name: '重构', planActive: true, busy: true });
    expect(t).toContain('dscode');
    expect(t).toContain('「重构」');
    expect(t).toContain('[plan]');
    expect(t).toContain('⏳');
  });

  it('无徽标时仅应用名', () => {
    expect(titleBarText({})).toContain('dscode');
    expect(titleBarText({})).not.toContain('[plan]');
  });
});

describe('分区信息区（A+B：contextBar / statusBarText / shortenPath）', () => {
  it('contextBar 含进度条与剩余量（ASCII 兼容字符）', () => {
    const bar = contextBar(32768, 65536);
    expect(bar).toContain('[#####-----]'); // ASCII 块，不用 █/░（部分终端渲染为点）
    expect(bar).toContain('50%');
    expect(bar).toContain('剩 32.8K'); // fmtTokens(32768) = 32.8K
    expect(bar).toContain('\x1b[32m'); // <60% 绿色
  });

  it('contextBar 超窗钳制 100%', () => {
    const bar = contextBar(100000, 65536);
    expect(bar).toContain('[##########]');
    expect(bar).toContain('100%');
    expect(bar).toContain('剩 0');
    expect(bar).toContain('\x1b[31m'); // >80% 红色
  });

  it('shortenPath 截短保留末尾', () => {
    const s = shortenPath('/a/b/c/proj', 10);
    expect(s).toHaveLength(10);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('proj');
    expect(shortenPath('/short', 10)).toBe('/short'); // 不超长原样
  });

  it('shortenPath CJK 长目录：按可见宽度截短（非 .length），不拆字', () => {
    const s = shortenPath('一二三四五六七八九十', 8);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('十'); // 保留末尾
    expect(visibleLen(s)).toBeLessThanOrEqual(8); // 可见宽度 ≤ maxLen（CJK 计 2 列）
  });

  it('shortenPath 全角路径超 34 时截短（修复：原 .length 判定导致 34 个中文字符原样返回、状态行被截断）', () => {
    const wide = '很长的项目目录'.repeat(6); // 30 字符，可见宽 60
    const s = shortenPath(wide); // 默认 maxLen 34
    expect(s).not.toBe(wide); // 不再原样返回
    expect(visibleLen(s)).toBeLessThanOrEqual(34);
  });

  it('statusBarText 状态行不含目录（目录走底部独立完整行，TuiModel.cwd）', () => {
    const longCjk = '很长的项目目录'.repeat(10); // 可见宽 70
    const t = statusBarText({
      model: 'deepseek-v4-flash',
      cwd: longCjk,
      usedTokens: 1000,
      completionTokens: 500,
      cacheReadTokens: 128,
      requests: 3,
      contextWindow: 10000,
      cols: 80,
      name: '重构',
      planActive: true,
      busy: true,
    });
    expect(t).toContain('deepseek-v4-flash'); // 右侧模型名完整保留
    expect(t).toContain('「重构」');
    expect(t).toContain('1.5K/10K (15%)'); // token 统计不被挤掉
    expect(t).not.toContain(longCjk); // 状态行不含目录
    expect(t).not.toContain('…'); // 无截短省略号（目录不显示在状态行）
    expect(visibleLen(t)).toBeLessThanOrEqual(80); // 整行不超宽
  });

  it('statusBarText 参考样式：左 cwd+usage 右 model 两端对齐', () => {
    const longCwd = '/very/long/path/to/my/project/with/a/very/long/name';
    const t = statusBarText({
      model: 'deepseek-v4-flash',
      cwd: longCwd,
      usedTokens: 1000,
      completionTokens: 500,
      cacheReadTokens: 128,
      requests: 3,
      contextWindow: 10000,
      cols: 100,
      name: '重构',
      planActive: true,
      busy: true,
    });
    expect(t).toContain('「重构」');
    expect(t).toContain('[plan]');
    expect(t).toContain('⏳');
    expect(t).toContain('↑1K ↓500'); // ↑input ↓output
    expect(t).toContain('R3 CH128');
    expect(t).toContain('1.5K/10K (15%)'); // 已用/窗口 (pct)
    expect(t).toContain('deepseek-v4-flash'); // 右端 model
    expect(t).not.toContain(longCwd); // 路径已截短
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

describe('renderDiffText / renderEventText（edit/write 后 diff 着色展示，原理-file-tools.md §6）', () => {
  it('renderDiffText：- 红 + 绿 @@ 青 ---/+++ 灰，前缀行原样保留', () => {
    const out = renderDiffText('--- a/c.txt\n+++ b/c.txt\n@@ -1 +1 @@\n-foo\n+bar\n baz');
    expect(out).toContain('\x1b[90m--- a/c.txt\x1b[0m');
    expect(out).toContain('\x1b[90m+++ b/c.txt\x1b[0m');
    expect(out).toContain('\x1b[36m@@ -1 +1 @@\x1b[0m');
    expect(out).toContain('\x1b[31m-foo\x1b[0m');
    expect(out).toContain('\x1b[32m+bar\x1b[0m');
    expect(out).toContain(' baz'); // 上下文行不着色
  });

  it('renderEventText：成功 edit 结果带 metadata.diff 时输出着色 diff；无 diff 时不输出', () => {
    const withDiff = renderEventText({
      type: 'tool_result',
      toolCallId: 'c1',
      toolName: 'edit',
      output: '已应用 1 个编辑到 c.txt（+1 -1）',
      isError: false,
      metadata: { diff: '--- a/c.txt\n+++ b/c.txt\n@@ -1 +1 @@\n-foo\n+bar', diffStats: { added: 1, removed: 1 } },
    });
    expect(withDiff).toContain('\x1b[31m-foo\x1b[0m');
    expect(withDiff).toContain('\x1b[32m+bar\x1b[0m');

    const plain = renderEventText({ type: 'tool_result', toolCallId: 'c2', toolName: 'read', output: 'ok', isError: false });
    expect(plain).toBe('');
  });
});
