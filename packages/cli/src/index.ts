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
    return;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return;
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
