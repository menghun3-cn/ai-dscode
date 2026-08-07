/**
 * 终端可见宽度（原理-tui.md §3、todos M1-S5 P1）。
 * 全角（中文/日文/全角标点）占 2 列、半角占 1 列、组合字符占 0 列。
 * 按码点迭代，绝不拆代理对（emoji 等）。
 */

/** East Asian Wide / Fullwidth 主区间（覆盖中文/日文/韩文/全角符号） */
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK 部首扩充、CJK 符号与标点
  [0x3041, 0x33ff], // 日文假名、CJK 兼容扩充、CJK 兼容符号
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 统一表意文字
  [0xa000, 0xa4cf], // 彝文
  [0xac00, 0xd7a3], // 韩文音节
  [0xf900, 0xfaff], // CJK 兼容表意文字
  [0xfe30, 0xfe4f], // CJK 兼容形式
  [0xff00, 0xff60], // 全角 ASCII 变体
  [0xffe0, 0xffe6], // 全角符号
  [0x1f300, 0x1faff], // emoji（表情/符号/交通/补充符号，现代终端占 2 列）
  [0x20000, 0x2fffd], // CJK 扩展 B-F
];

/** 组合字符（宽 0）：重音符号等 */
const COMBINING_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function isWide(cp: number): boolean {
  return inRanges(cp, WIDE_RANGES);
}

function isCombining(cp: number): boolean {
  return inRanges(cp, COMBINING_RANGES);
}

/** 字符串在终端占用的列数（全角 = 2，组合字符 = 0） */
export function visibleWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCombining(cp)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

/** 光标列位置 = 前缀的可见宽度（IME 候选框定位用） */
export function cursorCol(prefix: string): number {
  return visibleWidth(prefix);
}

/** 按可见宽度截断到 ≤ maxWidth 列；不拆代理对、不在全角字符中间切断 */
export function truncateByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const cw = isCombining(cp) ? 0 : isWide(cp) ? 2 : 1;
    if (w + cw > maxWidth) break;
    w += cw;
    out += ch;
  }
  return out;
}
