/**
 * bash 工具（原理-沙盒执行.md、需求 FR-3.4、todos M1-S3）。
 * - 子进程执行（bash -c），保留 shell 语义；数组传参防注入
 * - 超时：SIGTERM → 宽限 → SIGKILL（Windows 上 taskkill /T 杀进程树）
 * - 输出截断 50KB：继续排空管道（不 pause，防子进程阻塞），但不存储超限部分
 * - cwd 可配（默认 ctx.cwd，禁止逃逸出工作目录）
 */

import { spawn, execFile } from 'node:child_process';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { tryResolve } from '../util/path.js';

export const BASH_OUTPUT_LIMIT = 50 * 1024; // 50KB
const DEFAULT_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 300;
/** 杀进程后若 close 仍未触发，强制返回的兜底时长 */
const FORCE_RESOLVE_MS = 2_000;

export const bashParams = Type.Object({
  command: Type.String({ description: '要执行的 shell 命令' }),
  cwd: Type.Optional(Type.String({ description: '工作目录（默认当前 cwd）' })),
  timeout: Type.Optional(Type.Integer({ minimum: 1, description: '超时毫秒数（默认 30000）' })),
});

export type BashParams = Static<typeof bashParams>;

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
  timedOut: boolean;
}

export const bashTool: Tool<BashParams> = {
  name: 'bash',
  description: '在受控子进程中执行 shell 命令，返回 stdout/stderr（各截断 50KB）与退出码。危险命令会被权限规则拦截。',
  parameters: bashParams,

  async execute(_toolCallId, params, ctx) {
    const cwdResolved = params.cwd ? tryResolve(ctx.cwd, params.cwd) : { path: ctx.cwd };
    if ('error' in cwdResolved) {
      return { output: cwdResolved.error, isError: true };
    }
    const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;

    const result = await runCommand(params.command, cwdResolved.path, timeoutMs, ctx.signal);

    const output = [
      result.stdout ? `[stdout]\n${result.stdout}` : '',
      result.stderr ? `[stderr]\n${result.stderr}` : '',
      `[exit=${result.exitCode ?? 'killed'}${result.signal ? ` signal=${result.signal}` : ''}${result.timedOut ? ' timeout' : ''}]`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      output,
      metadata: {
        exitCode: result.exitCode,
        signal: result.signal,
        truncated: result.truncated,
        timedOut: result.timedOut,
      },
      isError: result.exitCode !== 0 || result.timedOut,
    };
  },
};

/** 执行命令并收集输出（可被测试直接调用） */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<BashResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    /** 收集输出：只存前 LIMIT 字节，但继续消费管道（不 pause，防子进程阻塞挂死） */
    const collect = (buf: string, target: 'stdout' | 'stderr') => {
      const current = target === 'stdout' ? stdout : stderr;
      if (current.length < BASH_OUTPUT_LIMIT) {
        const room = BASH_OUTPUT_LIMIT - current.length;
        if (target === 'stdout') stdout += buf.slice(0, room);
        else stderr += buf.slice(0, room);
        if (buf.length > room) truncated = true;
      } else {
        truncated = true;
      }
    };

    child.stdout?.on('data', (b: Buffer) => collect(b.toString('utf8'), 'stdout'));
    child.stderr?.on('data', (b: Buffer) => collect(b.toString('utf8'), 'stderr'));

    let timer: NodeJS.Timeout | undefined;
    let forceTimer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      externalSignal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode, signal, truncated, timedOut });
    };

    /** 杀进程树：Windows 下 taskkill /T /F 连带孙进程，否则 stdout 管道被孙进程持有、close 不触发 */
    const killTree = () => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && !settled) child.kill('SIGKILL');
        if (process.platform === 'win32' && child.pid) {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
        }
      }, KILL_GRACE_MS);
      // 兜底：即便 close 不触发也强制返回（防超时测试挂死）
      forceTimer = setTimeout(() => finish(child.exitCode, child.signalCode ?? null), FORCE_RESOLVE_MS);
      forceTimer.unref?.();
    };

    const onAbort = () => {
      killTree();
    };
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    child.on('spawn', () => {
      timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);
      timer.unref?.();
    });
    child.on('error', (err) => {
      // spawn 失败（如 bash 不存在）
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}
