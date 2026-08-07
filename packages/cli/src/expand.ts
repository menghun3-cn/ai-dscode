/**
 * 输入展开（todos M1-S5 P1）：`@path` 文件引用 + `!cmd` 命令注入。
 * - `@a.txt 你好` → 把 a.txt 内容内联进输入，模型可见
 * - `!ls -la` → 执行命令并把输出内联进输入
 * 复用 readTool（路径安全 + 截断）与 runCommand（超时 + 50KB 截断），
 * 注入文本带 [文件]/[命令] 标记，便于模型区分来源。
 */

import { readTool, runCommand } from '@dscode/core';

const AT_RE = /@([^\s]+)/g;
const BANG_RE = /!([^\n]*)/g;

interface Expansion {
  start: number;
  end: number;
  repl: string;
}

/** 展开输入中的 @文件 与 !命令；返回展开后的完整文本 */
export async function expandInput(input: string, cwd: string): Promise<string> {
  const parts: Expansion[] = [];

  for (const m of input.matchAll(AT_RE)) {
    const ref = m[1]!;
    const repl = await readRef(ref, cwd);
    parts.push({ start: m.index!, end: m.index! + m[0].length, repl });
  }
  for (const m of input.matchAll(BANG_RE)) {
    const cmd = m[1]!.trim();
    if (!cmd) continue;
    const repl = await runRef(cmd, cwd);
    parts.push({ start: m.index!, end: m.index! + m[0].length, repl });
  }
  parts.sort((a, b) => a.start - b.start);

  // 过滤重叠（如 `!echo @a.txt`：@ 被命令文本吞掉，不再单独展开）
  const applied: Expansion[] = [];
  let lastEnd = 0;
  for (const p of parts) {
    if (p.start >= lastEnd) {
      applied.push(p);
      lastEnd = p.end;
    }
  }

  let out = '';
  let pos = 0;
  for (const p of applied) {
    out += input.slice(pos, p.start) + p.repl;
    pos = p.end;
  }
  out += input.slice(pos);
  return out;
}

async function readRef(ref: string, cwd: string): Promise<string> {
  const res = await readTool.execute('expand', { path: ref }, { cwd });
  return `[文件 ${ref}]\n${res.output}\n[文件结束]`;
}

async function runRef(cmd: string, cwd: string): Promise<string> {
  const res = await runCommand(cmd, cwd, 30_000);
  const body = [res.stdout, res.stderr].filter(Boolean).join('\n') || '(无输出)';
  const status = res.timedOut ? '超时' : `exit=${res.exitCode ?? 'killed'}`;
  return `[命令 ${cmd} ${status}]\n${body}\n[命令结束]`;
}
