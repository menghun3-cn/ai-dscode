/**
 * TUI 交互控制器（纯函数：交互状态迁移，无终端 I/O）。
 * 把"输入行 → 菜单状态"的交互逻辑从 tui.ts 的 _ttyWrite 中抽出，可完整单测——
 * 替代本环境不可用的 PTY 集成测试（winpty 需 console stdin，node-pty/script 不可用），
 * 让"输入 / 开菜单、↑↓ 导航、Enter 选中、Esc 关闭"成为可执行成功标准。
 */

import type { TuiModel } from './tui-render.js';

/** 根据输入行刷新候选菜单（completions 由调用方提供：/ 命令补全 或 @ 文件补全）；无候选则关闭 */
export function updateMenuForLine(m: TuiModel, line: string, completions: (line: string) => string[]): void {
  const candidates = completions(line);
  if (candidates.length > 0) {
    if (!m.menu) {
      m.menu = { candidates, index: 0 };
    } else {
      // 前缀变化：保留仍在候选中的选中项，否则重置
      const cur = m.menu.candidates[m.menu.index];
      m.menu.candidates = candidates;
      m.menu.index = cur && candidates.includes(cur) ? candidates.indexOf(cur) : 0;
    }
  } else if (m.menu) {
    m.menu = null;
  }
}

/** ↑↓ 导航菜单（循环） */
export function menuStep(m: TuiModel, dir: -1 | 1): void {
  if (!m.menu || m.menu.candidates.length === 0) return;
  const n = m.menu.candidates.length;
  m.menu.index = (m.menu.index + dir + n) % n;
}

/** Esc 关闭菜单 */
export function menuClose(m: TuiModel): void {
  m.menu = null;
}

/** Enter 选中：返回当前选中候选（无菜单返回 null） */
export function menuPick(m: TuiModel): string | null {
  if (!m.menu) return null;
  return m.menu.candidates[m.menu.index] ?? null;
}
