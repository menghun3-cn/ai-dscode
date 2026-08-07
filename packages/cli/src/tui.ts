/**
 * interactive TUI（原理-tui.md §6、todos M1-S5）。
 * MVP 最小边界：单行输入 + 滚动输出。readline terminal 模式提供
 * 行编辑与 Ctrl+C 信号；流式输出逐 token 写入 stdout。
 * 不做组件树 / @ 引用 / ! 命令 / IME（P1 打磨项）。
 */

import readline from 'node:readline';
import process from 'node:process';
import type { AgentEvent, AgentSession } from '@dscode/core';
import { handleSlash, type SlashCommandContext } from './commands.js';

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cost: number;
}

const MODEL_COST: Record<string, { input: number; output: number; cacheRead: number }> = {
  'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14 },
};

/** 渲染一个 agent 事件到 stdout（纯文本滚动） */
export function renderEvent(ev: AgentEvent): void {
  switch (ev.type) {
    case 'message_update':
      process.stdout.write(ev.content);
      break;
    case 'reasoning_update':
      process.stdout.write(`\x1b[90m${ev.content}\x1b[0m`); // 灰色展示思考过程
      break;
    case 'tool_call':
      process.stdout.write(`\n\x1b[36m⚙ ${ev.toolName}\x1b[0m `);
      try {
        const args = JSON.parse(ev.args) as Record<string, unknown>;
        process.stdout.write(JSON.stringify(args).slice(0, 200));
      } catch {
        process.stdout.write(ev.args.slice(0, 200));
      }
      process.stdout.write('\n');
      break;
    case 'tool_result':
      if (ev.isError) process.stdout.write(`\x1b[31m✗ ${ev.output.slice(0, 300)}\x1b[0m\n`);
      break;
    default:
      break;
  }
}

export function costText(model: string, usage: UsageStats): string {
  const cost = MODEL_COST[model];
  const input = cost ? (usage.promptTokens / 1_000_000) * cost.input : 0;
  const output = cost ? (usage.completionTokens / 1_000_000) * cost.output : 0;
  const cache = cost ? (usage.cacheReadTokens / 1_000_000) * cost.cacheRead : 0;
  const total = input + output + cache;
  return `模型 ${model} · input ${usage.promptTokens} tok · output ${usage.completionTokens} tok · cache ${usage.cacheReadTokens} tok · 预估成本 $${total.toFixed(4)}`;
}

export async function runInteractive(session: AgentSession): Promise<number> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '\x1b[32mdscode>\x1b[0m ',
  });

  let model = session.model;
  let running = false;
  const usage: UsageStats = { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0 };

  const slashCtx: SlashCommandContext = {
    get model() {
      return model;
    },
    setModel: (id) => {
      model = id;
      session.setModel(id);
    },
    clearMessages: () => {
      session.messages.length = 0;
    },
    costText: () => costText(model, usage),
  };

  const onSigint = () => {
    if (running) {
      session.abort(); // 中止当前运行（SC-1.9：Ctrl+C 可中断）
      process.stdout.write('\n[已中止]\n');
      rl.prompt();
    } else {
      process.stdout.write('\n');
      rl.close();
      process.exit(0);
    }
  };

  rl.on('SIGINT', onSigint);
  process.stdout.write('dscode — 输入 /help 查看命令，/exit 退出\n');
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    // slash 命令
    const res = handleSlash(input, slashCtx);
    if (res.handled) {
      if (res.output) process.stdout.write(`${res.output}\n`);
      if (res.exitCode !== undefined) {
        rl.close();
        return res.exitCode;
      }
      rl.prompt();
      continue;
    }

    // Agent 任务
    running = true;
    try {
      for await (const ev of session.run(input)) {
        if (ev.type === 'message_update') {
          // 流式逐 token 输出
          process.stdout.write(ev.content);
        } else {
          renderEvent(ev);
        }
        if (ev.type === 'tool_call') {
          // 估算：tool_call 数计入 usage（精确计数 M3 由 provider usage 事件落地）
          usage.completionTokens += 1;
        }
      }
      process.stdout.write('\n');
    } catch (err) {
      process.stdout.write(`\n\x1b[31m任务异常: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    } finally {
      running = false;
    }
    rl.prompt();
  }

  return 0;
}
