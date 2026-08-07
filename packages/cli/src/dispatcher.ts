/**
 * 模式分发器（架构文档 §4.2.9、todos M1-S5）。
 * 按 args 分发：interactive（TUI）/ print / json / rpc。
 * json 占位（v1.0 落地）；rpc 已落地（todos M7）。
 */

import process from 'node:process';
import readline from 'node:readline/promises';
import { saveAuthKey } from '@dscode/ai';
import type { CliArgs, CliMode } from './args.js';
import { buildSession } from './build-session.js';
import { runPrint } from './print.js';
import { runJson } from './json.js';
import { runInteractive } from './tui.js';
import { runRpc } from './rpc.js';

/** 判定实际模式：显式非默认 --mode 优先（如 `-p "x" --mode json`，SC-6.3）；否则 -p 即 print；默认 interactive */
export function resolveMode(args: CliArgs): CliMode {
  if (args.mode && args.mode !== 'interactive') return args.mode;
  if (args.printPrompt !== undefined) return 'print';
  return args.mode ?? 'interactive';
}

/** SC-1.1：首次运行引导——提示输入 DeepSeek key，写入 auth.json（0600） */
export async function firstRunPromptAndSave(): Promise<string | undefined> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // stdin EOF（管道输入结束 / 非交互）时 readline 关闭：竞速优雅返回，避免挂死
    const answer = await Promise.race([
      rl.question('未找到 DeepSeek API key。请输入（将保存到 auth.json，仅本机可见）: ').catch(() => undefined),
      new Promise<string | undefined>((resolve) => rl.once('close', () => resolve(undefined))),
    ]);
    const key = answer?.trim();
    if (!key) return undefined;
    await saveAuthKey({ key });
    process.stdout.write('已保存 API key。\n');
    return key;
  } finally {
    rl.close();
  }
}

/** 分发到对应模式，返回进程退出码 */
export async function dispatch(args: CliArgs): Promise<number> {
  const mode = resolveMode(args);

  const { session, extManager, authError } = await buildSession(args);
  if (authError || !session) {
    // interactive 模式：SC-1.1 首次运行引导输入 key；print 模式直接报错（CI 不弹交互）
    if (mode === 'interactive') {
      process.stdout.write(`${authError}\n`);
      const key = await firstRunPromptAndSave();
      if (!key) {
        console.error('未提供 API key，退出。');
        return 1;
      }
      // 保存后重建会话（auth.json 现在可解析）
      const rebuilt = await buildSession({ ...args, apiKey: key });
      if (rebuilt.authError || !rebuilt.session) {
        console.error(rebuilt.authError ?? '会话构建失败');
        return 1;
      }
      return runInteractive(rebuilt.session, rebuilt.extManager);
    }
    console.error(authError ?? '会话构建失败');
    return 1;
  }

  if (mode === 'print') {
    return runPrint(session, args.printPrompt, args.positionals);
  }
  if (mode === 'json') {
    return runJson(session, args.printPrompt, args.positionals); // 每行 {type,data} 事件流（todos M7-S3）
  }
  if (mode === 'rpc') {
    return runRpc(session); // JSON-RPC over stdio（todos M7）
  }
  // interactive（TUI）
  return runInteractive(session, extManager);
}

export { process };
