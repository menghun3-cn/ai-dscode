/**
 * TUI 纯渲染层（对齐 pi 的差分渲染架构：组件 render(width)→lines，模型驱动全屏帧）。
 * 本模块为纯函数：无终端 I/O，布局逻辑可完整单测（不依赖真实终端）——
 * 根治此前"增量 ANSI 修补 + readline 光标冲突"反复引入的回归。
 */

import { truncateByWidth, visibleWidth } from './width.js';
import type { AgentEvent } from '@dscode/core';

/** 命令候选描述（菜单区右侧说明） */
export const COMMAND_HINTS: Record<string, string> = {
  '/model': '<provider/model> 切换模型（打开选择器）',
  '/thinking': 'reasoning 展示：stream/fold/off',
  '/cost': '本次会话预估成本',
  '/compact': '压缩上下文（可带指令）',
  '/plan': '进入 Plan 模式（只读）',
  '/plan-set': '设置计划步骤',
  '/accept-plan': '接受计划进入执行',
  '/allow': '允许并持久化规则',
  '/deny': '拒绝并持久化规则',
  '/tree': '查看会话树',
  '/fork': '从节点分叉新分支',
  '/clone': '克隆会话',
  '/name': '设置会话名',
  '/export': '导出会话（HTML/JSONL）',
  '/resume': '列出本目录会话并恢复',
  '/reload': '热重载扩展',
  '/extensions': '列出已加载扩展',
  '/skill': '列出/加载 skills',
  '/help': '查看全部命令',
  '/exit': '退出（保存会话）',
};

/** 菜单候选窗口高度（输入框下方固定保留区，箭头滚动查看更多） */
export const MENU_WINDOW = 4;

/** 输入框最大显示高度（多行输入 Shift+Enter 展开/超长折行，超出滚动） */
export const MAX_INPUT_HEIGHT = 5;

/** 输入框当前高度（1..MAX_INPUT_HEIGHT，按 \n 数） */
export function inputHeightOf(input: string): number {
  return Math.min(Math.max(1, input.split('\n').length), MAX_INPUT_HEIGHT);
}

/**
 * 超长输入软折行：把 input 折成 ≤ MAX_INPUT_HEIGHT 的可视行数组（输入框渲染/高度计算共用，保证光标定位一致）。
 * - 按 \n 拆逻辑行；每行按可见宽度折行（不拆代理对/全角）
 * - 首行首段可用宽 = cols-promptWidth（prompt 占位）；其余段（首行续行 + 后续逻辑行）可用宽 = cols-indent（续行缩进）
 * - 空行/空输入 → ['']（输入区至少 1 行）
 */
export function inputWrap(input: string, cols: number, promptWidth: number, indent = 2): string[] {
  const rows: string[] = [];
  for (const [i, seg] of input.split('\n').entries()) {
    const firstW = Math.max(1, cols - (i === 0 ? promptWidth : indent));
    const restW = Math.max(1, cols - indent);
    const first = truncateByWidth(seg, firstW);
    rows.push(first);
    let rest = seg.slice(first.length);
    while (rest.length > 0) {
      const chunk = truncateByWidth(rest, restW);
      if (chunk === '') break; // 防御：极窄列避免死循环
      rows.push(chunk);
      rest = rest.slice(chunk.length);
    }
  }
  return rows;
}

/** 输入框布局高度（1..MAX_INPUT_HEIGHT，含超长折行；超出后窗口锚定光标显示尾部） */
export function inputRowsOf(input: string, cols: number, promptWidth: number): number {
  return Math.min(inputWrap(input, cols, promptWidth).length, MAX_INPUT_HEIGHT);
}

/** 输入 prompt 的可见宽度（busy ⏳ 占位不同，光标列/首行折行宽度计算用） */
export function inputPromptWidth(busy: boolean): number {
  return visibleLen(promptText(busy));
}

/** 输入光标（字符索引）→ 可视行号（折行后）+ 该行内可见列（多行输入/超长折行光标定位用） */
export function inputCursorToPos(input: string, cursor: number, cols = 80, promptWidth = 8, indent = 2): { line: number; col: number } {
  const lines = input.split('\n');
  let remaining = Math.max(0, Math.min(cursor, input.length));
  // 定位逻辑行（remaining ≤ 该行长度；换行符占 1）
  let line = 0;
  for (; line < lines.length; line++) {
    if (remaining <= lines[line]!.length) break;
    remaining -= lines[line]!.length + 1;
  }
  if (line >= lines.length) line = Math.max(0, lines.length - 1);
  // 该逻辑行在折行网格中的起始可视行号 = 前面各逻辑行的折行行数之和
  let baseRow = 0;
  for (let i = 0; i < line; i++) {
    baseRow += inputWrap(lines[i] ?? '', cols, promptWidth, indent).length;
  }
  const seg = lines[line] ?? '';
  const firstW = Math.max(1, cols - (line === 0 ? promptWidth : indent));
  const restW = Math.max(1, cols - indent);
  let offset = 0;
  // 段 0（首行宽）
  const chunk0 = truncateByWidth(seg, firstW);
  if (remaining <= chunk0.length) {
    return { line: baseRow, col: visibleLen(seg.slice(0, remaining)) };
  }
  offset = chunk0.length;
  let row = 1;
  while (offset < seg.length) {
    const chunk = truncateByWidth(seg.slice(offset), restW);
    if (chunk === '') break;
    if (remaining <= offset + chunk.length) {
      return { line: baseRow + row, col: visibleLen(seg.slice(offset, remaining)) };
    }
    offset += chunk.length;
    row++;
  }
  // 兜底：光标在行尾/超尾
  return { line: baseRow + Math.max(0, row - 1), col: visibleLen(seg.slice(offset)) };
}

/** 底部固定区行数（随输入/菜单/任务高度动态变化，对齐 Pi）：任务区(动态) + 运行状态行1 + 上分隔线1 + 输入(折行感知) + 菜单(动态) + 下分隔线1 + 完整目录行1 + 状态1 */
export function fixedRowsFor(input: string, menuHeight = 0, taskRows = 0, cols = 80, promptWidth = 8): number {
  return taskRows + 1 + inputRowsOf(input, cols, promptWidth) + menuHeight + 4;
}

/** 底部固定区行数（单行输入 + 无菜单）：运行状态行1 + 上分隔线1 + 输入1 + 下分隔线1 + 完整目录行1 + 状态1 */
export const FIXED_ROWS = 6;

/** 菜单动态高度：菜单打开且有候选 = MENU_WINDOW，否则 0（输入框默认单行，弹出时上移） */
export function menuHeightOf(m: { menu?: TuiMenu | null }): number {
  return m.menu && m.menu.candidates.length > 0 ? MENU_WINDOW : 0;
}

/** 菜单候选窗口：围绕 index 显示 w 条 */
export function menuWindow(index: number, total: number, w: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(index - Math.floor(w / 2), Math.max(0, total - w)));
  return { start, end: Math.min(total, start + w) };
}

export interface SgrMouseEvent {
  /** 按钮：64=滚轮上 / 65=滚轮下；其他为点击等 */
  button: number;
  x: number;
  y: number;
}

/** 解析 SGR 鼠标序列（\x1b[<b;x;yM 按下 / m 释放）；非鼠标序列返回 null */
export function parseSgrMouse(seq: string): SgrMouseEvent | null {
  const m = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)[Mm]$/);
  if (!m) return null;
  return { button: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/**
 * 判定字符串是否为 SGR 鼠标序列（或可分片补全的部分）——滚轮字节必须在此被拦截，绝不落入输入行。
 * - buf 非空：已在序列中，后续字节继续缓冲
 * - 前缀完整 `\x1b[<...`（可缺结尾）
 * - 前缀被剥的完整形 `64;9;35M`（Bun readline 剥掉 \x1b[< 后传入）
 * - 前缀被剥的部分形 `64;9;35`（三字段已齐、缺终止符——鼠标坐标恒为 2 个分号，不会误吞普通数字输入）
 */
export function isSgrFragment(s: string, buf: string): boolean {
  if (buf) return true;
  if (s.startsWith('\x1b[<')) return true;
  if (/^[\d;]+[Mm]$/.test(s)) return true;
  if (/^\d+;\d+;\d+$/.test(s)) return true;
  return false;
}

/** 单元格宽：CJK 计 2、常见 emoji 计 2（终端实际渲染多为双列——少计会导致行超宽换行残留，即"重复显示"根因） */
function cellWidth(cp: number): number {
  if (
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji 增补区
    (cp >= 0x2600 && cp <= 0x27bf) || // 杂项符号/装饰（☀★♥ 等）
    (cp >= 0x23e9 && cp <= 0x23ff) || // ⏩⏳ 等
    (cp >= 0x2b00 && cp <= 0x2bff) || // ⭐ 等
    cp === 0x200d // ZWJ（emoji 组合）
  ) {
    return 2;
  }
  return cp > 0x2e80 ? 2 : 1;
}

/** 可见宽度：去 ANSI 后按 CJK/emoji 计 2（状态行两端对齐/光标列计算用） */
export function visibleLen(s: string): number {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) w += cellWidth(ch.codePointAt(0)!);
  return w;
}

export interface TuiMenu {
  candidates: string[];
  index: number;
  /** 选择器模式（如 /model）：回车调用 apply 而非提交行 */
  apply?: (pick: string) => void;
}

export interface TuiModel {
  /** 输出区行（可含样式 ANSI；渲染时取尾部可视行，超宽截断） */
  outputLines: string[];
  /** 输出视口锚定（绝对起始行；null=跟随最新——回看后视口固定，流式追加不推走历史） */
  outputAnchor?: number | null;
  /** 输入行内容 */
  input: string;
  /** 输入光标列（0-based，位于 input 内） */
  inputCursor: number;
  /** 菜单（null=关闭） */
  menu: TuiMenu | null;
  /** 状态行文本（含样式） */
  status: string;
  /** 输入框上方的固定运行状态行（如 Running (6s · ↑ 2K tokens)；空=空闲） */
  runStatus?: string;
  /** 输入框上方的任务清单（agent 运行期 tool_call/tool_result 归集；空=不显示） */
  tasks?: TaskItem[];
  /** 完整工作目录（底部专用一行，完整显示不截短；超宽由渲染层兜底截断） */
  cwd?: string;
  busy: boolean;
}

/** 任务状态：待办（plan 步骤）/ 进行中（tool_call 已发）/ 已完成 / 失败 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface TaskItem {
  /** 唯一标识（tool_call 用 toolCallId；plan 步骤用 step id） */
  id: string;
  /** 展示标题（工具名 + 目标路径/命令） */
  title: string;
  status: TaskStatus;
}

/** 任务清单最大展示行数（超出取最新 N 条，截断时顶部补一行提示） */
export const MAX_TASK_ROWS = 5;

/** 任务行数：无任务 0；有任务 ≤ MAX_TASK_ROWS（超出 +1 提示行） */
export function taskRowsOf(tasks?: TaskItem[]): number {
  if (!tasks || tasks.length === 0) return 0;
  return Math.min(tasks.length, MAX_TASK_ROWS) + (tasks.length > MAX_TASK_ROWS ? 1 : 0);
}

/** 从 tool_call args JSON 提炼短标题（path/command/pattern 优先，解析失败退化为工具名） */
export function taskTitleOf(toolName: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const target =
      (typeof args['path'] === 'string' && args['path'] !== '' && args['path']) ||
      (typeof args['command'] === 'string' && args['command'] !== '' && args['command']) ||
      (typeof args['pattern'] === 'string' && args['pattern'] !== '' && args['pattern']);
    return target ? `${toolName} ${target}` : toolName;
  } catch {
    return toolName;
  }
}

/**
 * 从 agent 事件归集任务清单（纯函数，可单测）。
 * - tool_call → 追加 running 任务（标题=工具名+目标）
 * - tool_result → 匹配 toolCallId 标记 done/failed
 * - plan 步骤由 tui.ts 在每次 agent 任务开始时以 pending 状态预置（作为清单底座）
 */
export function applyTaskEvent(tasks: TaskItem[], ev: AgentEvent): TaskItem[] {
  switch (ev.type) {
    case 'tool_call':
      return [...tasks, { id: ev.toolCallId, title: taskTitleOf(ev.toolName, ev.args), status: 'running' }];
    case 'tool_result':
      return tasks.map((t) => (t.id === ev.toolCallId ? { ...t, status: ev.isError ? 'failed' : 'done' } : t));
    default:
      return tasks;
  }
}

export interface TuiFrame {
  /** 完整屏幕帧（rows 行，含样式） */
  lines: string[];
  /** 硬件光标应定位的行（0-based，输入行） */
  cursorRow: number;
  /** 硬件光标应定位的列（0-based） */
  cursorCol: number;
}

function sepLine(cols: number): string {
  return `\x1b[90m${'─'.repeat(cols)}\x1b[0m`;
}

/** 按可见宽度截断（跳过 ANSI 转义序列，CJK 计 2 列），保留 ANSI 完整并闭合未终止样式——帧内行不允许换行 */
export function truncateAnsi(text: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  let w = 0;
  let out = '';
  let hasAnsi = false;
  let inEsc = false;
  for (const ch of text) {
    if (inEsc) {
      out += ch;
      if (ch === 'm' || ch === 'K' || ch === 'H' || ch === 'G') inEsc = false;
      continue;
    }
    if (ch === '\x1b') {
      inEsc = true;
      hasAnsi = true;
      out += ch;
      continue;
    }
    const cw = cellWidth(ch.codePointAt(0)!);
    if (w + cw > maxCols) break;
    w += cw;
    out += ch;
  }
  // 截断发生在样式区内时补闭合，避免颜色污染后续帧行
  return hasAnsi ? `${out}\x1b[0m` : out;
}

/** Codex 风格欢迎信息框（启动时 logo 下方显示；纯函数可单测）。内容宽 48（顶框 49 虚线，对齐参考布局） */
export function welcomeBox(opts: { version: string; model: string; cwd: string; approval: string }, cols: number): string {
  const inner = Math.max(20, Math.min(48, cols - 5)); // 内容宽（受终端宽度约束，最小 20）
  const fit = (s: string): string => truncateAnsi(s, inner);
  const modelHint = '   /model to change';
  let modelLine = `model:       ${opts.model}${modelHint}`;
  if (visibleLen(modelLine) > inner) modelLine = `model:       ${opts.model}`; // 模型名过长时省略提示
  const lines = [
    `>_ dscode (v${opts.version})`,
    '',
    fit(modelLine),
    fit(`directory:   ${opts.cwd}`),
    fit(`permissions: ${opts.approval}`),
  ];
  const top = `╭${'─'.repeat(inner + 1)}╮`;
  const bottom = `╰${'─'.repeat(inner + 1)}╯`;
  return [top, ...lines.map((l) => `│ ${l.padEnd(inner)}│`), bottom].join('\n');
}

function promptText(busy: boolean): string {
  return busy ? '\x1b[33m⏳ dscode>\x1b[0m ' : '\x1b[32mdscode>\x1b[0m ';
}

/** 渲染菜单保留区第 row 行（0..MENU_WINDOW-1） */
function menuRow(m: TuiModel, row: number, cols: number): string {
  if (!m.menu || m.menu.candidates.length === 0) return '';
  const { start, end } = menuWindow(m.menu.index, m.menu.candidates.length, MENU_WINDOW);
  const idx = start + row;
  if (idx >= end) return '';
  const cand = m.menu.candidates[idx]!;
  const marker = idx === m.menu.index ? '\x1b[36m→\x1b[0m' : '  ';
  const hint = COMMAND_HINTS[cand];
  const text = truncateByWidth(`${cand}${hint ? `  \x1b[90m${hint}\x1b[0m` : ''}`, cols - 2);
  return `${marker} ${text}`;
}

/** 任务行状态标记（含色）：待办 ○ 灰 / 进行中 ▶ 黄 / 完成 ✓ 绿 / 失败 ✗ 红 */
const TASK_MARKERS: Record<TaskStatus, string> = {
  pending: '\x1b[90m○\x1b[0m',
  running: '\x1b[33m▶\x1b[0m',
  done: '\x1b[32m✓\x1b[0m',
  failed: '\x1b[31m✗\x1b[0m',
};

/** 渲染任务清单第 row 行（0..taskRowsOf-1；超 MAX_TASK_ROWS 时顶部补"共 N 项"提示，其余显示最新 N 条） */
function taskRow(m: TuiModel, row: number, cols: number): string {
  const tasks = m.tasks ?? [];
  const total = tasks.length;
  const truncated = total > MAX_TASK_ROWS;
  if (truncated) {
    if (row === 0) return `\x1b[90m… 共 ${total} 项任务（显示最新 ${MAX_TASK_ROWS} 项）\x1b[0m`;
    const t = tasks[total - MAX_TASK_ROWS + row - 1]!;
    return truncateAnsi(`${TASK_MARKERS[t.status]} ${t.title}`, cols);
  }
  const t = tasks[row];
  return t ? truncateAnsi(`${TASK_MARKERS[t.status]} ${t.title}`, cols) : '';
}

/**
 * 渲染完整屏幕帧（纯函数）。
 * 布局（自顶向下）：输出区(rows-固定区行数，滚动取尾部) → 任务区(动态，有任务时显示) → 运行状态行 → 上分隔线 → 输入行 → 菜单保留区(4 行) → 下分隔线 → 状态行。
 */
export function renderLayout(m: TuiModel, cols: number, rows: number): TuiFrame {
  const menuHeight = menuHeightOf(m); // 菜单动态高度（无菜单=0：输入框默认单行；弹出时输入框上移给候选项腾位，对齐 Pi）
  const taskRows = taskRowsOf(m.tasks); // 任务清单高度（动态：agent 运行期有任务时显示，位于输入框上方）
  const prompt = promptText(m.busy);
  const promptWidth = visibleLen(prompt);
  const inputRows = inputWrap(m.input, cols, promptWidth); // 折行后全部可视行（超长输入软换行）
  const totalInputRows = inputRows.length;
  const inputHeight = Math.min(totalInputRows, MAX_INPUT_HEIGHT); // 布局高度有界（超长折行滚动显示）
  const pos = inputCursorToPos(m.input, m.inputCursor, cols, promptWidth); // 光标在折行网格中的可视位置
  // 输入窗口：行数超 MAX_INPUT_HEIGHT 时锚定光标（光标始终可见），否则从头显示全部
  const winStart = Math.max(0, Math.min(pos.line - (inputHeight - 1), Math.max(0, totalInputRows - inputHeight)));
  const fixedRows = taskRows + 1 + inputHeight + menuHeight + 4; // 任务区(动态) + 运行状态行1 + 上分隔线1 + 输入 + 菜单(动态) + 下分隔线1 + 完整目录行1 + 状态1
  const outputRows = Math.max(1, rows - fixedRows);
  // 输出窗口：outputAnchor 为绝对起始行（null=跟随最新）；锚定后流式追加不移动视口（回看可用）
  const maxStart = Math.max(0, m.outputLines.length - outputRows);
  const start =
    m.outputAnchor === null || m.outputAnchor === undefined
      ? maxStart
      : Math.max(0, Math.min(m.outputAnchor, maxStart));
  const tail = m.outputLines.slice(start, start + outputRows);
  const lines: string[] = [];
  for (let i = 0; i < outputRows; i++) {
    lines.push(truncateAnsi(tail[i] ?? '', cols));
  }
  for (let i = 0; i < taskRows; i++) {
    lines.push(truncateAnsi(taskRow(m, i, cols), cols)); // 任务区（输入框上方：任务标题 + 完成状态）
  }
  lines.push(truncateAnsi(m.runStatus ?? '', cols)); // 输入框上方固定运行状态行（运行中实时显示，空=空闲）
  lines.push(sepLine(cols)); // 上分隔线
  for (let i = 0; i < inputHeight; i++) {
    const row = inputRows[winStart + i] ?? '';
    const abs = winStart + i; // 折行网格中的绝对行号：0=真正首行（带 prompt），其余缩进 2
    lines.push(truncateAnsi(abs === 0 ? `${prompt}${row}` : `  ${row}`, cols));
  }
  lines.push(sepLine(cols)); // 下分隔线（输入框底边：菜单在输入框下方，对齐 Pi/Codex 效果）
  for (let i = 0; i < menuHeight; i++) {
    lines.push(menuRow(m, i, cols)); // 菜单区（动态：仅菜单打开时显示，位于输入框下分隔线下方）
  }
  lines.push(truncateAnsi(m.cwd ?? '', cols)); // 完整目录行（不截短；超宽由 truncateAnsi 兜底截断，不挤压其他行）
  lines.push(truncateAnsi(m.status, cols)); // 状态行

  // 硬件光标：定位到输入光标所在行/列（任务区 + 运行状态行 + 上分隔线之后；折行窗口内）
  const cursorVisLine = pos.line - winStart;
  const cursorRow = outputRows + taskRows + 2 + cursorVisLine;
  const cursorCol = (winStart + cursorVisLine === 0 ? promptWidth : 2) + pos.col;
  return { lines, cursorRow, cursorCol };
}
