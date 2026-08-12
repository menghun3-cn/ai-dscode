#!/usr/bin/env node
/**
 * dscode CLI 入口（架构文档 §4.2.9、todos M1-S5）。
 * 解析 args → help? → 分发到 interactive/print/json/rpc。
 */

import { parseArgs, HELP_TEXT, DSCCODE_VERSION, type CliArgs } from './args.js';
import { dispatch } from './dispatcher.js';

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`参数错误: ${err instanceof Error ? err.message : String(err)}`);
    console.error(HELP_TEXT);
    process.exit(2);
  }

  if (args.version) {
    process.stdout.write(`dscode ${DSCCODE_VERSION}\n`);
    process.exit(0); // 显式退出：真实 TTY 下 stdin 保持打开，事件循环不会自然结束
  }

  // --tty-info：TUI 布局诊断（PowerShell 下 Bun 的 rows/columns/isTTY 可能不可靠，用户可核验实际值）
  if (args.ttyInfo) {
    const so = process.stdout as unknown as { isTTY?: boolean; rows?: number; columns?: number };
    process.stdout.write(
      [
        `isTTY=${so.isTTY}`,
        `stdout.rows=${so.rows ?? 'undefined'}`,
        `stdout.columns=${so.columns ?? 'undefined'}`,
        `DSCODE_ROWS=${process.env['DSCODE_ROWS'] ?? '(未设置)'}`,
        `DSCODE_COLS=${process.env['DSCODE_COLS'] ?? '(未设置)'}`,
        `TERM=${process.env['TERM'] ?? '(未设置)'}`,
        `terminal=${process.env['WT_SESSION'] ? 'Windows Terminal' : process.env['ConEmuANSI'] ? 'ConEmu' : process.env['TERM_PROGRAM'] ?? '(未知)'}`,
      ].join('\n') + '\n',
    );
    process.exit(0); // 显式退出：真实 TTY 下 stdin 保持打开，事件循环不会自然结束
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const exitCode = await dispatch(args);
  process.exit(exitCode);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (process.env['DSCODE_DEBUG'] === '1') {
    // 仅 DEBUG 模式给堆栈（NFR-4 可观测），正常不裸栈给用户（横切项 P1 错误体验）
    console.error(`dscode 异常退出: ${err instanceof Error ? (err.stack ?? msg) : msg}`);
  } else {
    console.error(`dscode 异常退出: ${msg}（DSCODE_DEBUG=1 可查看详细堆栈）`);
  }
  process.exit(1);
});
