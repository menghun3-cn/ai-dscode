/**
 * ctx.ui（架构文档 §4.2.8、todos M4-S5）。
 * 扩展可弹确认框 / 输入 / 选择 / 通知。核心定义接口 + 默认控制台实现，
 * CLI/TUI 可注入 readline 实现。
 */

export interface ExtensionUi {
  /** 确认框：返回是否确认 */
  confirm(title: string, message?: string): Promise<boolean>;
  /** 输入框：返回用户输入（取消返回 undefined） */
  input(message: string): Promise<string | undefined>;
  /** 选择器：返回选中的 option（取消返回 undefined） */
  select(options: string[], message?: string): Promise<number | undefined>;
  /** 通知 */
  notify(message: string): Promise<void>;
}

/** 默认实现：走控制台（无 TUI 时的兜底） */
export const consoleUi: ExtensionUi = {
  async confirm(title, message) {
    const g = globalThis as { confirm?: (msg: string) => boolean };
    return typeof g.confirm === 'function' ? g.confirm(`${title}${message ? `\n${message}` : ''}`) : true;
  },
  async input(message) {
    process.stderr.write(`${message}\n（无交互 TUI，扩展 input 不可用）`);
    return undefined;
  },
  async select() {
    process.stderr.write('（无交互 TUI，扩展 select 不可用）\n');
    return undefined;
  },
  async notify(message) {
    process.stderr.write(`[ext] ${message}\n`);
  },
};
