/**
 * 模式分发器（架构文档 §4.2.9、todos M1-S5）。
 * 按 args 分发：interactive（TUI）/ print / json / rpc。
 * json/rpc 本期占位（v0.4+ 落地），先保证分支命中正确。
 */

import process from 'node:process';
import type { CliArgs, CliMode } from './args.js';
import { buildSession } from './build-session.js';
import { runPrint } from './print.js';
import { runInteractive } from './tui.js';

/** 判定实际模式：-p 即 print；否则取 --mode，默认 interactive */
export function resolveMode(args: CliArgs): CliMode {
  if (args.printPrompt !== undefined) return 'print';
  return args.mode ?? 'interactive';
}

/** 分发到对应模式，返回进程退出码 */
export async function dispatch(args: CliArgs): Promise<number> {
  const mode = resolveMode(args);

  // json/rpc 占位（v0.4+ 落地），先保证分支命中（日志可见 mode）
  if (mode === 'json') {
    console.error('[dscode] json 模式将在 v0.4 落地（当前为占位分支）');
    return 0;
  }
  if (mode === 'rpc') {
    console.error('[dscode] rpc 模式将在 v0.4 落地（当前为占位分支）');
    return 0;
  }

  const { session, authError } = await buildSession(args);
  if (authError || !session) {
    console.error(authError ?? '会话构建失败');
    return 1;
  }

  if (mode === 'print') {
    return runPrint(session, args.printPrompt, args.positionals);
  }
  // interactive（TUI）
  return runInteractive(session);
}

export { process };
