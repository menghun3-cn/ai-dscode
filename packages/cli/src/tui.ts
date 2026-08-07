/**
 * interactive TUI（原理-tui.md §6、todos M1-S5）。
 * MVP 最小边界：单行输入 + 滚动输出。readline terminal 模式提供
 * 行编辑与 Ctrl+C 信号；流式输出逐 token 写入 stdout。
 * P1 已落地：`@文件` 引用、`!命令` 注入（expand.ts）；中文宽度见 width.ts。
 */

import readline, { type Key } from 'node:readline';
import process from 'node:process';
import type { AgentEvent, AgentSession } from '@dscode/core';
import { deepseekModels } from '@dscode/ai';
import { handleSlash, commandCompletions, cycleMenuIndex, type SlashCommandContext } from './commands.js';
import { expandInput } from './expand.js';
import { truncateByWidth } from './width.js';

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
        process.stdout.write(truncateByWidth(JSON.stringify(args), 200));
      } catch {
        process.stdout.write(truncateByWidth(ev.args, 200));
      }
      process.stdout.write('\n');
      break;
    case 'tool_result':
      if (ev.isError) process.stdout.write(`\x1b[31m✗ ${truncateByWidth(ev.output, 300)}\x1b[0m\n`);
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

/** token 友好格式化：1.2K / 518.8K / 1M / 1.2M（整数省略小数） */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}K`;
  }
  return `${n}`;
}

/** 秒数友好格式化：5s / 1m 27s */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** 底部状态栏文本：模型 · 路径 · used/窗口 tok (占比) */
export function statusText(opts: { model: string; cwd: string; usedTokens: number; contextWindow: number }): string {
  const pct = opts.contextWindow > 0 ? Math.round((opts.usedTokens / opts.contextWindow) * 100) : 0;
  return `${opts.model} · ${opts.cwd} · ${fmtTokens(opts.usedTokens)}/${fmtTokens(opts.contextWindow)} tok (${pct}%)`;
}

export async function runInteractive(session: AgentSession): Promise<number> {
  const availableModels = deepseekModels.map((m) => m.id);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '\x1b[32mdscode>\x1b[0m ',
    // 候选提示由下方命令菜单承载（↑↓ 选择），不再用 readline 自带 Tab 补全
  });

  let model = session.model;
  let running = false;
  const usage: UsageStats = { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0 };

  const contextWindowOf = (modelId: string): number =>
    deepseekModels.find((m) => m.id === modelId)?.contextWindow ?? 65536;

  // 底部状态栏：保存光标 → 移到末行 → 清行 → 写状态 → 恢复光标
  const drawStatusBar = () => {
    if (!process.stdout.isTTY) return;
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const text = truncateByWidth(
      statusText({ model, cwd: session.cwd, usedTokens: usage.promptTokens, contextWindow: contextWindowOf(model) }),
      cols - 1,
    );
    process.stdout.write(`\x1b[s\x1b[${rows};1H\x1b[K${text}\x1b[u`);
  };
  const refresh = () => {
    drawStatusBar();
    rl.prompt();
  };

  // 命令候选菜单：输入 / 或 /xxx 时在输入行下方弹出，↑↓ 选择、回车执行
  let menu: { candidates: string[]; index: number } | null = null;
  let menuLines = 0;

  /** 绘制/刷新菜单（保存光标 → 清旧区 → 画新区 → 恢复光标） */
  const drawMenu = () => {
    if (!process.stdout.isTTY) return;
    process.stdout.write('\x1b[s');
    for (let i = 0; i < menuLines; i++) {
      process.stdout.write('\x1b[1B\x1b[1G\x1b[2K'); // 下1行 → 列1 → 清整行
    }
    const n = menu ? menu.candidates.length : 0;
    for (let i = 0; i < n; i++) {
      process.stdout.write('\x1b[1B\x1b[1G');
      const text = i === menu!.index ? `\x1b[7m${menu!.candidates[i]}\x1b[0m` : menu!.candidates[i]!;
      process.stdout.write(`${text}\x1b[K`);
    }
    menuLines = n;
    process.stdout.write('\x1b[u');
  };

  /** 根据当前输入行刷新候选菜单（无候选则关闭） */
  const updateMenu = (line: string) => {
    const candidates = commandCompletions(line, availableModels);
    if (candidates.length > 0) {
      if (!menu) {
        menu = { candidates, index: 0 };
      } else {
        // 前缀变化：保留仍在候选中的选中项，否则重置
        const cur = menu.candidates[menu.index];
        menu.candidates = candidates;
        menu.index = cur && candidates.includes(cur) ? candidates.indexOf(cur) : 0;
      }
      drawMenu();
    } else if (menu) {
      menu = null;
      drawMenu(); // 清空旧菜单区
    }
  };

  // 键盘拦截（readline 内部 _ttyWrite）：菜单激活时 ↑↓ 选择、回车执行、Esc 关闭
  const rlAny = rl as unknown as { _ttyWrite: (s: string, key: Key) => void };
  const origTtyWrite = rlAny._ttyWrite.bind(rl);
  rlAny._ttyWrite = (s: string, key: Key) => {
    if (menu) {
      if (key.name === 'up') {
        menu.index = cycleMenuIndex(menu.index, -1, menu.candidates.length);
        drawMenu();
        return; // 不传给 readline（避免触发历史导航）
      }
      if (key.name === 'down') {
        menu.index = cycleMenuIndex(menu.index, 1, menu.candidates.length);
        drawMenu();
        return;
      }
      if (key.name === 'escape') {
        menu = null;
        drawMenu(); // 清空菜单区
        return;
      }
      if (key.name === 'return') {
        const pick = menu.candidates[menu.index] ?? rl.line;
        menu = null;
        drawMenu(); // 清空菜单区
        // rl.line 类型标记 readonly，运行时为普通可写属性；提交行以它为准
        (rl as unknown as { line: string }).line = pick;
        origTtyWrite('\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' });
        return;
      }
    }
    origTtyWrite(s, key);
    updateMenu(rl.line); // 输入变化时实时刷新候选
  };

  const slashCtx: SlashCommandContext = {
    get model() {
      return model;
    },
    availableModels,
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
      refresh();
    } else {
      process.stdout.write('\n');
      rl.close();
      process.exit(0);
    }
  };

  rl.on('SIGINT', onSigint);
  process.stdout.write('dscode — 输入 /help 查看命令，/exit 退出\n');
  refresh();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      refresh();
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
      refresh();
      continue;
    }

    // Agent 任务：先展开 @文件 / !命令 注入（P1）
    running = true;
    const turnStart = Date.now();
    try {
      const expanded = await expandInput(input, session.cwd);
      for await (const ev of session.run(expanded)) {
        if (ev.type === 'message_update') {
          // 流式逐 token 输出
          process.stdout.write(ev.content);
        } else {
          renderEvent(ev);
        }
        if (ev.type === 'agent_settled') {
          // 真实 usage 更新统计（替换原 tool_call 估算），并显示耗时/tokens
          usage.promptTokens = ev.usage.prompt_tokens ?? usage.promptTokens;
          usage.completionTokens = ev.usage.completion_tokens ?? usage.completionTokens;
          usage.cacheReadTokens = ev.usage.cache_read_input_tokens ?? usage.cacheReadTokens;
          const elapsed = fmtDuration(Date.now() - turnStart);
          process.stdout.write(`\x1b[90m(${elapsed} · ↑ ${fmtTokens(usage.promptTokens)} tokens)\x1b[0m`);
        }
      }
      process.stdout.write('\n');
    } catch (err) {
      process.stdout.write(`\n\x1b[31m任务异常: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    } finally {
      running = false;
    }
    refresh();
  }

  return 0;
}
