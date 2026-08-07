/**
 * bash 工具（原理-沙盒执行.md、需求 FR-3.4、todos M1-S3）。
 * - 子进程执行（bash -c），保留 shell 语义；数组传参防注入
 * - 超时：SIGTERM → 宽限 → SIGKILL（Windows 上 taskkill /T 杀进程树）
 * - 输出截断 50KB：继续排空管道（不 pause，防子进程阻塞），但不存储超限部分
 * - cwd 可配（默认 ctx.cwd，禁止逃逸出工作目录）
 */

import { spawn, spawnSync, execFile } from 'node:child_process';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { tryResolve } from '../util/path.js';

export const BASH_OUTPUT_LIMIT = 50 * 1024; // 50KB
const DEFAULT_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 300;
/** 杀进程后若 close 仍未触发，强制返回的兜底时长 */
const FORCE_RESOLVE_MS = 2_000;

/**
 * 解析可用的 shell（进程内缓存）：
 * 1. DSCODE_SHELL / SHELL 环境变量显式指定
 * 2. `bash`（PATH 中，Git Bash）
 * 3. Windows 常见 Git Bash 安装路径
 * 4. `sh` 兜底
 * 找不到时返回 null，由 runCommand 报告明确错误。
 */
let cachedShell: string | null | undefined;
export function resolveShell(): string | null {
  if (cachedShell !== undefined) return cachedShell;
  const candidates = [
    process.env['DSCODE_SHELL'],
    process.env['SHELL'],
    'bash',
    // Windows Git Bash 常见安装位置（PATH 里没有 bash 时的兜底）
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'sh',
  ].filter((s): s is string => Boolean(s));
  for (const shell of candidates) {
    try {
      const r = spawnSync(shell, ['--version'], { stdio: 'ignore' });
      if (!r.error) {
        cachedShell = shell;
        return shell;
      }
    } catch {
      // 该候选不可用，继续下一个
    }
  }
  cachedShell = null;
  return null;
}

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
  /** spawn 失败时的真实错误（如 bash 未找到的 ENOENT） */
  spawnError?: string;
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
      result.spawnError ? `[shell 启动失败]\n${result.spawnError}` : '',
      result.stdout ? `[stdout]\n${result.stdout}` : '',
      result.stderr ? `[stderr]\n${result.stderr}` : '',
      result.spawnError ? '' : `[exit=${result.exitCode ?? 'killed'}${result.signal ? ` signal=${result.signal}` : ''}${result.timedOut ? ' timeout' : ''}]`,
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
        spawnError: result.spawnError,
      },
      isError: result.exitCode !== 0 || result.timedOut || Boolean(result.spawnError),
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
    const shell = resolveShell();
    if (!shell) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: null,
        truncated: false,
        timedOut: false,
        spawnError: '未找到可用的 shell（bash/sh）。请安装 Git Bash 并加入 PATH，或设置 DSCODE_SHELL 指定 shell 路径。',
      });
      return;
    }
    const child = spawn(shell, ['-c', command], {
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

    const finish = (exitCode: number | null, signal: string | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      externalSignal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode, signal, truncated, timedOut, spawnError });
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
      // spawn 失败（如 shell 启动被拒）：报告真实错误，而不是笼统 killed
      finish(null, null, err.message);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}
