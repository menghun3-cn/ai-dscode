/**
 * TUI 纯渲染层（对齐 pi 的差分渲染架构：组件 render(width)→lines，模型驱动全屏帧）。
 * 本模块为纯函数：无终端 I/O，布局逻辑可完整单测（不依赖真实终端）——
 * 根治此前"增量 ANSI 修补 + readline 光标冲突"反复引入的回归。
 */

import { truncateByWidth, visibleWidth } from './width.js';

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

/** 输入框最大显示高度（多行输入 Shift+Enter 展开，超出滚动） */
export const MAX_INPUT_HEIGHT = 5;

/** 输入框当前高度（1..MAX_INPUT_HEIGHT，按 \n 数） */
export function inputHeightOf(input: string): number {
  return Math.min(Math.max(1, input.split('\n').length), MAX_INPUT_HEIGHT);
}

/** 底部固定区行数（随输入高度变化）：上分隔线1 + 输入 + 菜单 + 下分隔线1 + 状态1 */
export function fixedRowsFor(input: string): number {
  return 1 + inputHeightOf(input) + MENU_WINDOW + 2;
}

/** 底部固定区行数（单行输入）：上分隔线1 + 输入1 + 菜单4 + 下分隔线1 + 状态1 */
export const FIXED_ROWS = MENU_WINDOW + 4;

/** 输入光标（字符索引）→ 行号 + 该行内可见列（多行输入光标定位用） */
export function inputCursorToPos(input: string, cursor: number): { line: number; col: number } {
  const lines = input.split('\n');
  let remaining = Math.max(0, Math.min(cursor, input.length));
  for (let i = 0; i < lines.length; i++) {
    if (remaining <= lines[i]!.length) return { line: i, col: visibleLen(lines[i]!.slice(0, remaining)) };
    remaining -= lines[i]!.length + 1; // +1 换行符
  }
  const last = lines[lines.length - 1] ?? '';
  return { line: lines.length - 1, col: visibleLen(last) };
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
  /** 输出区向上回看偏移（行数，0=跟随最新） */
  outputScroll?: number;
  /** 输入行内容 */
  input: string;
  /** 输入光标列（0-based，位于 input 内） */
  inputCursor: number;
  /** 菜单（null=关闭） */
  menu: TuiMenu | null;
  /** 状态行文本（含样式） */
  status: string;
  busy: boolean;
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

/**
 * 渲染完整屏幕帧（纯函数）。
 * 布局（自顶向下）：输出区(rows-FIXED_ROWS 行，滚动取尾部) → 上分隔线 → 输入行 → 菜单保留区(4 行) → 下分隔线 → 状态行。
 */
export function renderLayout(m: TuiModel, cols: number, rows: number): TuiFrame {
  const inputHeight = inputHeightOf(m.input);
  const fixedRows = 1 + inputHeight + MENU_WINDOW + 2; // 上分隔线 + 输入(动态高) + 菜单 + 下分隔线 + 状态
  const outputRows = Math.max(1, rows - fixedRows);
  // 输出窗口：向上回看 outputScroll 行（0=跟随最新，即尾部 outputRows 行）
  const scroll = Math.min(m.outputScroll ?? 0, Math.max(0, m.outputLines.length - outputRows));
  const end = m.outputLines.length - scroll;
  const tail = m.outputLines.slice(Math.max(0, end - outputRows), end);
  const lines: string[] = [];
  for (let i = 0; i < outputRows; i++) {
    lines.push(truncateAnsi(tail[i] ?? '', cols));
  }
  lines.push(sepLine(cols)); // 上分隔线
  const prompt = promptText(m.busy);
  const inputSegs = m.input.split('\n');
  for (let i = 0; i < inputHeight; i++) {
    const seg = inputSegs[i] ?? '';
    // 首行带 prompt，续行缩进 2（多行输入视觉延续）
    lines.push(truncateAnsi(i === 0 ? `${prompt}${seg}` : `  ${seg}`, cols));
  }
  for (let i = 0; i < MENU_WINDOW; i++) {
    lines.push(menuRow(m, i, cols)); // 菜单保留区
  }
  lines.push(sepLine(cols)); // 下分隔线
  lines.push(truncateAnsi(m.status, cols)); // 状态行

  // 硬件光标：定位到输入光标所在行/列（多行输入行号 + 行内列）
  const pos = inputCursorToPos(m.input, m.inputCursor);
  const cursorRow = outputRows + 1 + pos.line;
  const cursorCol = (pos.line === 0 ? visibleLen(prompt) : 2) + pos.col;
  return { lines, cursorRow, cursorCol };
}
