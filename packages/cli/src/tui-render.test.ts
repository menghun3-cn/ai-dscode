import { describe, expect, it } from 'vitest';
import { renderLayout, menuWindow, truncateAnsi, inputHeightOf, inputCursorToPos, parseSgrMouse, welcomeBox, fixedRowsFor, MENU_WINDOW, FIXED_ROWS, type TuiModel } from './tui-render.js';

function model(over: Partial<TuiModel> = {}): TuiModel {
  return { outputLines: [], input: '', inputCursor: 0, menu: null, status: '状态', busy: false, ...over };
}

describe('renderLayout（纯函数全帧渲染，对齐 pi 差分渲染架构）', () => {
  it('帧结构（无菜单，默认单行）：输出区 + 运行状态行 + 上分隔线 + 输入行 + 下分隔线 + 状态行，共 rows 行', () => {
    const frame = renderLayout(model(), 40, 20);
    expect(frame.lines.length).toBe(20);
    const outputRows = 20 - FIXED_ROWS; // 15（无菜单：运行状态行1+上分隔线1+输入1+下分隔线1+状态1）
    expect(frame.lines[outputRows]!).toBe(''); // 运行状态行（空闲空行）
    expect(frame.lines[outputRows + 1]!).toContain('─'); // 上分隔线
    expect(frame.lines[outputRows + 2]!).toContain('dscode>'); // 输入行（prompt）
    expect(frame.lines[outputRows + 3]!).toContain('─'); // 下分隔线（无菜单时紧邻输入行）
    expect(frame.lines[outputRows + 4]!).toBe('状态'); // 状态行（最底）
  });

  it('菜单弹出时输入框上移（动态布局，对齐 Pi）：菜单区出现在输入框下方', () => {
    const base = model();
    const closed = renderLayout(base, 40, 20);
    const open = renderLayout(model({ menu: { candidates: ['/model', '/cost'], index: 0 } }), 40, 20);
    // 菜单打开：固定区 +MENU_WINDOW 行 → 输入行绝对位置上移
    expect(open.cursorRow).toBe(closed.cursorRow - MENU_WINDOW);
    // 菜单区在输入框下分隔线之后渲染候选
    expect(open.lines[open.cursorRow + 1]).toContain('─'); // 输入行下一行是下分隔线
    expect(open.lines[open.cursorRow + 2]).toContain('/model'); // 下分隔线之后是菜单第 1 项
    // 菜单关闭：恢复单行（无菜单区）
    expect(closed.lines[closed.cursorRow + 1]).toContain('─'); // 输入行下一行是下分隔线
  });

  it('运行状态行：固定显示在输入框上方（运行中显示，空闲空行）', () => {
    const idle = renderLayout(model(), 40, 20);
    expect(idle.lines[20 - FIXED_ROWS]).toBe('');
    const running = renderLayout(model({ runStatus: 'Running (6s · ↑ 2K tokens)' }), 40, 20);
    expect(running.lines[20 - FIXED_ROWS]).toContain('Running');
    expect(running.lines[20 - FIXED_ROWS]).toContain('tokens');
  });

  it('光标定位：输入行行号 + prompt 宽 + 输入光标列', () => {
    const frame = renderLayout(model({ input: 'ab', inputCursor: 1 }), 40, 20);
    expect(frame.cursorRow).toBe(20 - FIXED_ROWS + 2); // 输入行在帧内位置（运行状态行 + 上分隔线之后）
    // prompt 可见宽 8（"dscode> "）+ 光标前 "a" 宽 1
    expect(frame.cursorCol).toBe(8 + 1);
  });

  it('输出区滚动：只显示尾部 outputRows 行', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `行${i}`);
    const frame = renderLayout(model({ outputLines: lines }), 40, 20);
    const outputRows = 20 - FIXED_ROWS; // 15（无菜单）
    // 帧的第 0 行应是第 30-15=15 行
    expect(frame.lines[0]).toBe('行15');
    expect(frame.lines[outputRows - 1]).toBe('行29');
  });

  it('菜单渲染：→ 选中项 + 候选名在输入框下分隔线下方，无菜单时无菜单区', () => {
    const m = model({ menu: { candidates: ['/model', '/cost'], index: 0 } });
    const frame = renderLayout(m, 60, 20);
    const outputRows = 20 - fixedRowsFor('', MENU_WINDOW); // 11（菜单打开：+MENU_WINDOW 行）
    expect(frame.lines[outputRows + 2]).toContain('dscode>'); // 输入行（上移）
    expect(frame.lines[outputRows + 3]).toContain('─'); // 输入框下分隔线
    expect(frame.lines[outputRows + 4]).toContain('→');
    expect(frame.lines[outputRows + 4]).toContain('/model');
    expect(frame.lines[outputRows + 5]).not.toContain('→'); // 未选中项无标记
    expect(frame.lines[outputRows + 5]).toContain('/cost');
  });

  it('busy 提示符显示 ⏳', () => {
    const frame = renderLayout(model({ busy: true }), 40, 20);
    const outputRows = 20 - FIXED_ROWS;
    expect(frame.lines[outputRows + 2]).toContain('⏳');
  });
});

describe('menuWindow（候选窗口滚动）', () => {
  it('总数小于窗口：全显示', () => {
    expect(menuWindow(0, 3, 4)).toEqual({ start: 0, end: 3 });
  });
  it('index 居中时窗口包含 index', () => {
    const { start, end } = menuWindow(10, 20, 4);
    expect(start).toBeLessThanOrEqual(10);
    expect(end).toBeGreaterThan(10);
  });
  it('index 在开头：start=0', () => {
    expect(menuWindow(0, 20, 4)).toEqual({ start: 0, end: 4 });
  });
  it('index 在末尾：窗口贴底', () => {
    const { start, end } = menuWindow(19, 20, 4);
    expect(end).toBe(20);
    expect(start).toBe(16);
  });
});

describe('truncateAnsi（ANSI 感知 + CJK 宽度截断）', () => {
  it('中文按 2 列截断，不拆字', () => {
    expect(truncateAnsi('你好世界', 4)).toBe('你好'); // 4 列 = 2 个中文
    expect(truncateAnsi('你好世界', 3)).toBe('你'); // 3 列放不下第 2 个中文
  });
  it('ANSI 序列不计宽且保持完整', () => {
    const out = truncateAnsi('\x1b[31m红色文字\x1b[0m', 5);
    expect(out).toBe('\x1b[31m红色\x1b[0m'); // 4 列 + 完整 ANSI（不残缺）
  });
});

describe('inputHeightOf / inputCursorToPos（多行输入）', () => {
  it('输入高度：单行=1，按 \\n 数展开，上限 MAX_INPUT_HEIGHT', () => {
    expect(inputHeightOf('abc')).toBe(1);
    expect(inputHeightOf('a\nb')).toBe(2);
    expect(inputHeightOf('1\n2\n3\n4\n5\n6\n7')).toBe(5); // 上限 5
  });
  it('光标定位：换行后行号 + 行内列', () => {
    expect(inputCursorToPos('ab\ncd', 0)).toEqual({ line: 0, col: 0 });
    expect(inputCursorToPos('ab\ncd', 3)).toEqual({ line: 1, col: 0 }); // 3 = 'a','b','\n' 之后
    expect(inputCursorToPos('ab\ncd', 5)).toEqual({ line: 1, col: 2 }); // 行内 'cd' 结尾
  });
  it('多行输入渲染：输入区随高度展开，光标在续行', () => {
    const frame = renderLayout(model({ input: '第一行\n第二行', inputCursor: 4 }), 60, 24);
    const outputRows = 24 - fixedRowsFor('第一行\n第二行'); // 18（无菜单：运行状态行1+上分隔线1+输入2+下分隔线1+状态1）
    // 输入区两行（首行带 prompt，续行缩进）——运行状态行 + 上分隔线之后
    expect(frame.lines[outputRows + 2]).toContain('第一行');
    expect(frame.lines[outputRows + 3]).toContain('第二行');
    // 光标在续行（line=1）
    expect(frame.cursorRow).toBe(outputRows + 2 + 1);
  });
});

describe('renderLayout（输出滚动回看）', () => {
  it('outputAnchor 回看：窗口显示锚定起点起的行', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `行${i}`);
    const frame = renderLayout(model({ outputLines: lines, outputAnchor: 10 }), 40, 20);
    const outputRows = 20 - FIXED_ROWS; // 15（无菜单）
    // 锚定 10：窗口为 slice(10, 25)
    expect(frame.lines[0]).toBe('行10');
    expect(frame.lines[outputRows - 1]).toBe('行24');
  });

  it('回看锚定：输出追加时视口不动（流式期间滚轮回看可用，对齐 pi sticky-footer）', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `行${i}`);
    const m = model({ outputLines: lines, outputAnchor: 0 });
    const f1 = renderLayout(m, 40, 20);
    expect(f1.lines[0]).toBe('行0');
    m.outputLines.push('行20', '行21'); // 流式追加
    const f2 = renderLayout(m, 40, 20);
    expect(f2.lines[0]).toBe('行0'); // 锚定视口不随追加移动（回看可用）
    // 跟随模式（null）：窗口显示最新尾部
    const follow = renderLayout(model({ outputLines: m.outputLines }), 40, 20);
    expect(follow.lines[0]).toBe('行7'); // 22-15=7
  });
});

describe('parseSgrMouse（鼠标滚轮事件解析）', () => {
  it('滚轮上（按钮 64）/滚轮下（按钮 65）', () => {
    expect(parseSgrMouse('\x1b[<64;20;5M')).toEqual({ button: 64, x: 20, y: 5 });
    expect(parseSgrMouse('\x1b[<65;20;5m')).toEqual({ button: 65, x: 20, y: 5 }); // 释放态也可解析
  });
  it('非鼠标序列返回 null', () => {
    expect(parseSgrMouse('\x1b[A')).toBeNull(); // 方向键
    expect(parseSgrMouse('abc')).toBeNull();
    expect(parseSgrMouse('\x1b[<64;20;5')).toBeNull(); // 未完成序列
  });
});

describe('welcomeBox（Codex 风格启动信息框，纯函数）', () => {
  const opts = { version: '1.0.0', model: 'deepseek-v4-flash', cwd: 'D:\\code\\ai-dscode-site', approval: 'ask' };
  it('框结构：顶/底边框 + 标题 + model/directory/permissions 字段', () => {
    const box = welcomeBox(opts, 100);
    const lines = box.split('\n');
    expect(lines[0]!.startsWith('╭')).toBe(true);
    expect(lines[lines.length - 1]!.startsWith('╰')).toBe(true);
    expect(box).toContain('>_ dscode (v1.0.0)');
    expect(box).toContain('model:       deepseek-v4-flash');
    expect(box).toContain('directory:   D:\\code\\ai-dscode-site');
    expect(box).toContain('permissions: ask');
    // 所有行等宽（边框对齐）
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
  });
  it('模型名过长时省略 /model to change 提示', () => {
    const box = welcomeBox({ ...opts, model: 'very-long-model-name-1234567890' }, 100);
    expect(box).not.toContain('/model to change');
    expect(box).toContain('very-long-model-name');
  });
  it('窄终端收缩内容宽不越界', () => {
    const box = welcomeBox(opts, 30);
    for (const line of box.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });
});
