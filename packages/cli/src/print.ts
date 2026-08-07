/**
 * print 模式（需求 FR-2.2、todos M1-S6、SC-1.8）。
 * 一次性首尾：`dscode -p "任务"`，纯文本流式输出，退出码反映成败。
 * 支持 stdin 管道：`echo "..." | dscode -p -`。
 */

import process from 'node:process';
import type { AgentSession } from '@dscode/core';

/** 读取 stdin（管道场景）；TTY 下返回空 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 解析 print prompt：显式文本 / `-` 读 stdin / 空读 stdin（SC-1.8 管道） */
export async function resolvePrintPrompt(prompt: string | undefined, positionals: string[]): Promise<string> {
  if (prompt && prompt !== '-') return prompt;
  const stdin = await readStdin();
  if (stdin.trim()) return stdin.trim();
  return positionals.join(' ');
}

export async function runPrint(session: AgentSession, prompt: string | undefined, positionals: string[] = []): Promise<number> {
  const input = await resolvePrintPrompt(prompt, positionals);
  if (!input.trim()) {
    process.stderr.write('print 模式缺少 prompt。用法: dscode -p "任务描述"，或管道输入: echo "..." | dscode -p -\n');
    return 2;
  }

  let sawError = false;
  let content = '';
  try {
    for await (const ev of session.run(input)) {
      if (ev.type === 'message_update') {
        content += ev.content;
        process.stdout.write(ev.content);
      } else if (ev.type === 'tool_result' && ev.isError) {
        sawError = true;
      }
    }
    process.stdout.write('\n');
  } catch (err) {
    process.stderr.write(`print 模式异常: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // 退出码反映成败（SC-1.8）：工具失败视为非零
  return sawError ? 1 : 0;
}
