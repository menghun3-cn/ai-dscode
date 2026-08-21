import { describe, expect, it } from 'vitest';
import {
  renderLayout,
  menuWindow,
  truncateAnsi,
  visibleLen,
  inputHeightOf,
  inputCursorToPos,
  inputWrap,
  inputRowsOf,
  inputPromptWidth,
  parseSgrMouse,
  isSgrFragment,
  welcomeBox,
  fixedRowsFor,
  applyTaskEvent,
  taskTitleOf,
  taskRowsOf,
  MENU_WINDOW,
  FIXED_ROWS,
  MAX_INPUT_HEIGHT,
  MAX_TASK_ROWS,
  type TuiModel,
  type TaskItem,
} from './tui-render.js';

function model(over: Partial<TuiModel> = {}): TuiModel {
  return { outputLines: [], input: '', inputCursor: 0, menu: null, status: '状态', busy: false, ...over };
}

describe('renderLayout（纯函数全帧渲染，对齐 pi 差分渲染架构）', () => {
  it('帧结构（无菜单，默认单行）：输出区 + 运行状态行 + 上分隔线 + 输入行 + 下分隔线 + 完整目录行 + 状态行，共 rows 行', () => {
    const frame = renderLayout(model(), 40, 20);
    expect(frame.lines.length).toBe(20);
    const outputRows = 20 - FIXED_ROWS; // 14（无菜单：运行状态行1+上分隔线1+输入1+下分隔线1+完整目录行1+状态1）
    expect(frame.lines[outputRows]!).toBe(''); // 运行状态行（空闲空行）
    expect(frame.lines[outputRows + 1]!).toContain('─'); // 上分隔线
    expect(frame.lines[outputRows + 2]!).toContain('dscode>'); // 输入行（prompt）
    expect(frame.lines[outputRows + 3]!).toContain('─'); // 下分隔线（无菜单时紧邻输入行）
    expect(frame.lines[outputRows + 4]!).toBe(''); // 完整目录行（默认空）
    expect(frame.lines[outputRows + 5]!).toBe('状态'); // 状态行（最底）
  });

  it('完整目录行：cwd 完整显示不截短，位于状态行上方', () => {
    const cwd = '/very/long/path/to/my/project/with/a/very/long/name';
    const frame = renderLayout(model({ cwd }), 100, 20); // 终端宽度足够容纳完整路径
    const outputRows = 20 - FIXED_ROWS;
    expect(frame.lines[outputRows + 4]).toBe(cwd); // 完整路径原样显示（无省略号、无截短）
    expect(frame.lines[outputRows + 5]).toBe('状态'); // 状态行仍在最底
  });

  it('完整目录行超宽：由渲染层兜底截断，不挤压状态行', () => {
    const cwd = 'a'.repeat(100); // 远超 40 列
    const frame = renderLayout(model({ cwd }), 40, 20);
    const outputRows = 20 - FIXED_ROWS;
    expect(visibleLen(frame.lines[outputRows + 4]!)).toBeLessThanOrEqual(40); // 兜底截断不超宽
    expect(frame.lines[outputRows + 5]).toBe('状态'); // 状态行不受影响
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
    const outputRows = 20 - FIXED_ROWS; // 14（无菜单，含完整目录行）
    // 帧的第 0 行应是第 30-14=16 行
    expect(frame.lines[0]).toBe('行16');
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

describe('inputWrap / inputRowsOf / inputPromptWidth（超长输入软换行）', () => {
  it('inputWrap：短输入 1 行；超长按 cols 折行（首行含 prompt 占位，续行缩进）', () => {
    expect(inputWrap('abc', 20, 8)).toEqual(['abc']);
    // cols=20, promptWidth=8 → 首行可用 12 列；续行可用 18 列（缩进 2）
    const rows = inputWrap('abcdefghijklmnopqrstuvwxyz', 20, 8);
    expect(rows).toEqual(['abcdefghijkl', 'mnopqrstuvwxyz']);
  });

  it('inputWrap：CJK 按 2 列折行不拆字；空输入 → [\'\']', () => {
    // cols=10, promptWidth=6 → 首行可用 4 列 = 2 个中文
    expect(inputWrap('你好世界', 10, 6)).toEqual(['你好', '世界']);
    expect(inputWrap('', 20, 8)).toEqual(['']);
  });

  it('inputRowsOf：≤MAX 原样；超长钳制为 MAX_INPUT_HEIGHT', () => {
    expect(inputRowsOf('abc', 20, 8)).toBe(1);
    const long = 'a'.repeat(200);
    expect(inputRowsOf(long, 20, 8)).toBe(MAX_INPUT_HEIGHT); // 200 字符折行远超 5 行上限
  });

  it('inputPromptWidth：空闲 8（"dscode> "），busy 含 ⏳ 更宽', () => {
    expect(inputPromptWidth(false)).toBe(8);
    expect(inputPromptWidth(true)).toBeGreaterThan(8);
  });
});

describe('inputCursorToPos（折行后光标定位，含 prompt 占位）', () => {
  const str = 'abcdefghijklmnopqrstuvwxyz'; // 26 字符；cols=20,promptWidth=8 → 首行 12 字符 + 续行 14 字符

  it('超长单行：光标在首行 / 折行边界 / 续行 / 行尾', () => {
    expect(inputCursorToPos(str, 0, 20, 8)).toEqual({ line: 0, col: 0 });
    expect(inputCursorToPos(str, 5, 20, 8)).toEqual({ line: 0, col: 5 });
    expect(inputCursorToPos(str, 12, 20, 8)).toEqual({ line: 0, col: 12 }); // 折行边界：仍在首行末尾
    expect(inputCursorToPos(str, 13, 20, 8)).toEqual({ line: 1, col: 1 }); // 续行行首 +1
    expect(inputCursorToPos(str, 26, 20, 8)).toEqual({ line: 1, col: 14 }); // 行尾（14 字符）
  });

  it('多逻辑行：baseRow 累加前面各逻辑行的折行行数', () => {
    // 第 1 逻辑行 12 字符（cols=30 下 1 行），'\n' 后第 2 逻辑行
    expect(inputCursorToPos('abcdefghijkl\nXYZ', 13, 30, 8)).toEqual({ line: 1, col: 0 });
    expect(inputCursorToPos('abcdefghijkl\nXYZ', 15, 30, 8)).toEqual({ line: 1, col: 2 });
    // 第 1 逻辑行超宽折成 2 行 → 第 2 逻辑行起点为 line 2
    expect(inputCursorToPos('abcdefghijklmnopqrstuvwxyz\nX', 27, 20, 8)).toEqual({ line: 2, col: 0 });
  });
});

describe('renderLayout（超长输入折行渲染）', () => {
  it('折行渲染：首行带 prompt，续行缩进；光标在续行内', () => {
    const input = 'abcdefghijklmnopqrstuvwxyz'; // 26 字符，cols=20 → 2 行
    const frame = renderLayout(model({ input, inputCursor: 26 }), 20, 24);
    const outputRows = 24 - fixedRowsFor(input, 0, 0, 20, 8); // 18（输入 2 行）
    expect(frame.lines[outputRows + 2]).toContain('dscode>'); // 首行：prompt + 前 12 字符
    expect(frame.lines[outputRows + 2]).toContain('abcdefghijkl');
    expect(frame.lines[outputRows + 3]).toContain('mnopqrstuvwxyz'); // 续行（缩进渲染）
    expect(frame.cursorRow).toBe(outputRows + 2 + 1); // 光标在续行
    expect(frame.cursorCol).toBe(2 + 14); // 缩进 2 + 行内列 14
  });

  it('超 MAX_INPUT_HEIGHT 行：窗口锚定光标（显示尾部，光标行始终可见）', () => {
    const input = 'a'.repeat(200); // cols=20 → 折行 12 行 > MAX 5
    const frame = renderLayout(model({ input, inputCursor: 199 }), 20, 30);
    const outputRows = 30 - fixedRowsFor(input, 0, 0, 20, 8); // 21（输入 5 行）
    // 输入区 5 行，窗口显示尾部：光标在最底行（始终可见）
    expect(frame.cursorRow).toBe(outputRows + 2 + (MAX_INPUT_HEIGHT - 1));
    // 底部窗口仍有输入内容（非空）
    expect(frame.lines[outputRows + 2 + (MAX_INPUT_HEIGHT - 1)]).toContain('a');
  });
});

describe('renderLayout（输出滚动回看）', () => {
  it('outputAnchor 回看：窗口显示锚定起点起的行', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `行${i}`);
    const frame = renderLayout(model({ outputLines: lines, outputAnchor: 10 }), 40, 20);
    const outputRows = 20 - FIXED_ROWS; // 14（无菜单，含完整目录行）
    // 锚定 10：窗口为 slice(10, 24)
    expect(frame.lines[0]).toBe('行10');
    expect(frame.lines[outputRows - 1]).toBe('行23');
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
    expect(follow.lines[0]).toBe('行8'); // 22-14=8
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

describe('isSgrFragment（滚轮字节拦截：分片/前缀剥离绝不落输入行）', () => {
  it('完整 SGR 序列（含 \x1b[< 前缀）识别为鼠标', () => {
    expect(isSgrFragment('\x1b[<64;20;5M', '')).toBe(true); // 滚轮上
    expect(isSgrFragment('\x1b[<0;20;5M', '')).toBe(true); // 点击（非滚轮）
  });

  it('前缀被剥的完整形（Bun readline 剥 \x1b[< 后传入）', () => {
    expect(isSgrFragment('64;20;5M', '')).toBe(true);
    expect(isSgrFragment('65;20;5m', '')).toBe(true); // 释放态
  });

  it('前缀被剥的部分形（三字段已齐、缺终止符）可进入缓冲等待补全', () => {
    expect(isSgrFragment('64;20;5', '')).toBe(true);
    expect(isSgrFragment('\x1b[<64;20;5', '')).toBe(true); // 前缀在但缺终止符
  });

  it('分片到达：buf 非空后任何后续字节继续缓冲（如补 M 终止符）', () => {
    expect(isSgrFragment('M', '\x1b[<64;20;5')).toBe(true); // 前一 chunk 已在缓冲
    expect(isSgrFragment('M', '64;20;5')).toBe(true);
  });

  it('普通输入不误判：纯文本/纯数字（无分号）不是 SGR', () => {
    expect(isSgrFragment('abc', '')).toBe(false);
    expect(isSgrFragment('123', '')).toBe(false); // 纯数字无分号：正常输入
    expect(isSgrFragment('64;20', '')).toBe(false); // 两字段部分形不足以判定
  });

  it('非滚轮鼠标事件也可解析（点击 button 0），由调用方消费不落输入行', () => {
    expect(parseSgrMouse(`\x1b[<0;20;5M`)).toEqual({ button: 0, x: 20, y: 5 });
    expect(isSgrFragment('0;20;5M', '')).toBe(true); // 剥前缀的点击序列同样拦截
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

describe('taskTitleOf / taskRowsOf（任务标题提炼与行数）', () => {
  it('title：path/command/pattern 优先，退化为工具名', () => {
    expect(taskTitleOf('edit', JSON.stringify({ path: 'src/a.ts', edits: [] }))).toBe('edit src/a.ts');
    expect(taskTitleOf('bash', JSON.stringify({ command: 'pnpm test' }))).toBe('bash pnpm test');
    expect(taskTitleOf('grep', JSON.stringify({ pattern: 'token' }))).toBe('grep token');
    expect(taskTitleOf('ls', JSON.stringify({}))).toBe('ls'); // 无目标字段
    expect(taskTitleOf('edit', 'not-json')).toBe('edit'); // 非法 JSON 不崩
  });

  it('taskRowsOf：无任务 0；≤MAX 原样；超 MAX 显示最新 N 条 + 1 提示行', () => {
    expect(taskRowsOf()).toBe(0);
    expect(taskRowsOf([])).toBe(0);
    const tasks: TaskItem[] = [1, 2, 3].map((i) => ({ id: `c${i}`, title: `t${i}`, status: 'done' }));
    expect(taskRowsOf(tasks)).toBe(3);
    const many: TaskItem[] = Array.from({ length: MAX_TASK_ROWS + 3 }, (_, i) => ({ id: `c${i}`, title: `t${i}`, status: 'done' }));
    expect(taskRowsOf(many)).toBe(MAX_TASK_ROWS + 1);
  });
});

describe('applyTaskEvent（tool_call/tool_result → 任务状态机，纯函数）', () => {
  const callEv = { type: 'tool_call' as const, toolCallId: 'c1', toolName: 'edit', args: '{"path":"a.ts","edits":[]}' };

  it('tool_call 追加 running 任务', () => {
    const tasks = applyTaskEvent([], callEv);
    expect(tasks).toEqual([{ id: 'c1', title: 'edit a.ts', status: 'running' }]);
  });

  it('tool_result 成功 → done；失败 → failed', () => {
    let tasks = applyTaskEvent([], callEv);
    tasks = applyTaskEvent(tasks, { type: 'tool_result', toolCallId: 'c1', toolName: 'edit', output: 'ok', isError: false });
    expect(tasks[0]!.status).toBe('done');
    tasks = applyTaskEvent([], callEv);
    tasks = applyTaskEvent(tasks, { type: 'tool_result', toolCallId: 'c1', toolName: 'edit', output: 'err', isError: true });
    expect(tasks[0]!.status).toBe('failed');
  });

  it('无关事件（message_update）不改变清单；plan 步骤以 pending 预置为底座', () => {
    const base: TaskItem[] = [{ id: 'step-1', title: '读需求', status: 'pending' }];
    const tasks = applyTaskEvent(base, { type: 'message_update', content: 'hello' });
    expect(tasks).toBe(base); // 引用不变
    const after = applyTaskEvent(base, callEv);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual({ id: 'step-1', title: '读需求', status: 'pending' });
    expect(after[1]!.status).toBe('running');
  });
});

describe('renderLayout（任务区：输入框上方显示任务清单与完成状态）', () => {
  it('有任务：任务区在运行状态行上方，标题 + 状态标记着色', () => {
    const tasks: TaskItem[] = [
      { id: 'c1', title: 'edit a.ts', status: 'running' },
      { id: 'c2', title: 'bash pnpm test', status: 'done' },
      { id: 'c3', title: 'grep token', status: 'failed' },
    ];
    const frame = renderLayout(model({ tasks, runStatus: 'Running (1s)' }), 40, 20);
    expect(frame.lines.length).toBe(20);
    const taskRows = taskRowsOf(tasks); // 3
    const outputRows = 20 - fixedRowsFor('', 0, taskRows); // 20-7=13
    expect(frame.lines[outputRows]).toContain('▶'); // running 黄
    expect(frame.lines[outputRows]).toContain('edit a.ts');
    expect(frame.lines[outputRows + 1]).toContain('✓'); // done 绿
    expect(frame.lines[outputRows + 1]).toContain('bash pnpm test');
    expect(frame.lines[outputRows + 2]).toContain('✗'); // failed 红
    expect(frame.lines[outputRows + 2]).toContain('grep token');
    expect(frame.lines[outputRows + 3]).toContain('Running'); // 运行状态行紧随任务区
    // 光标行：任务区 + 运行状态行 + 上分隔线之后
    expect(frame.cursorRow).toBe(outputRows + taskRows + 2);
  });

  it('超 MAX_TASK_ROWS：顶部补"共 N 项"提示行，其余显示最新 N 条', () => {
    const tasks: TaskItem[] = Array.from({ length: MAX_TASK_ROWS + 2 }, (_, i) => ({ id: `c${i}`, title: `任务${i}`, status: 'done' }));
    const frame = renderLayout(model({ tasks }), 60, 24);
    const outputRows = 24 - fixedRowsFor('', 0, taskRowsOf(tasks)); // 24-(5+1+3)=15
    expect(frame.lines[outputRows]).toContain('共 7 项任务');
    expect(frame.lines[outputRows + 1]).toContain('任务2'); // 最新 5 条：任务2..任务6
    expect(frame.lines[outputRows + MAX_TASK_ROWS]).toContain('任务6');
  });

  it('无任务：任务区不占行（布局与旧版一致，FIXED_ROWS 不变）', () => {
    const frame = renderLayout(model(), 40, 20);
    const outputRows = 20 - FIXED_ROWS;
    expect(frame.lines[outputRows]).toBe(''); // 运行状态行（空闲空行）
    expect(frame.cursorRow).toBe(outputRows + 2);
  });

  it('任务区与菜单共存：菜单在输入框下方，任务区在输入框上方', () => {
    const tasks: TaskItem[] = [{ id: 'c1', title: 'edit a.ts', status: 'running' }];
    const m = model({ tasks, menu: { candidates: ['/model', '/cost'], index: 0 } });
    const frame = renderLayout(m, 60, 20);
    const taskRows = 1;
    const outputRows = 20 - fixedRowsFor('', MENU_WINDOW, taskRows); // 20-(1+1+1+4+3)=10
    expect(frame.lines[outputRows]).toContain('edit a.ts'); // 任务区
    expect(frame.lines[outputRows + 1]).toContain(''); // 运行状态行（空闲空行）
    const inputRow = outputRows + taskRows + 2;
    expect(frame.lines[inputRow]).toContain('dscode>'); // 输入行
    expect(frame.lines[inputRow + 2]).toContain('/model'); // 菜单区（下分隔线之后）
  });
});
