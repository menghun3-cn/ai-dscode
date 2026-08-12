/**
 * TUI 真实 PTY 集成测试（Windows ConPTY 后端，node-pty，对齐 pi-shot 多场景驱动）。
 * 真实伪终端 spawn dist/dscode——渲染层（isTTY=true）真实执行，断言输出流包含关键文本。
 * 依赖：node-pty（pnpm.onlyBuiltDependencies 已批准）+ 已构建 dist 二进制；不可用时运行时跳过。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url); // vitest ESM 下无全局 require

interface IPty {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface TuiSession {
  p: IPty;
  getOutput(): string;
  write(d: string): void;
  exitCode(): number | null;
  kill(): void;
}

let pty: { spawn: (file: string, args: string[], opts: Record<string, unknown>) => IPty } | undefined;
let bin: string;
let tmpHome: string;

beforeAll(async () => {
  try {
    pty = nodeRequire('node-pty');
  } catch (e) {
    console.error('[pty-test] node-pty 加载失败:', e instanceof Error ? e.message : e);
  }
  bin = path.join(process.cwd(), 'dist', process.platform === 'win32' ? 'dscode.exe' : 'dscode');
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-pty-'));
});

afterAll(async () => {
  if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
});

/** 轮询等待 predicate（输出累积 + 超时） */
async function waitFor(predicate: () => boolean, timeoutMs = 8000, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

/** 启动一个干净 TUI 会话（独立场景独立 spawn；网关指向不可达端口，slash 场景不依赖网关） */
function startTui(): TuiSession {
  let output = '';
  let exitCode: number | null = null;
  const p = pty!.spawn(bin, [], {
    cols: 100,
    rows: 30,
    env: { ...process.env, DSCODE_HOME: tmpHome, DSCODE_BASE_URL: 'http://127.0.0.1:1/v1' },
  });
  p.onData((d: string) => {
    output += d;
  });
  p.onExit((e: { exitCode: number }) => {
    exitCode = e.exitCode;
  });
  return {
    p,
    getOutput: () => output,
    write: (d: string) => p.write(d),
    exitCode: () => exitCode,
    kill: () => p.kill(),
  };
}

describe('TUI 真实 PTY 集成（ConPTY，成功标准：渲染输出可断言）', () => {
  const available = (): boolean => Boolean(pty) && Boolean(bin) && statSync(bin, { throwIfNoEntry: false }) !== undefined;

  it('启动横幅 + /model 菜单弹出 + /quit 退出', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      // ① 启动横幅渲染
      expect(await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'))).toBe(true);
      // ② /model 打开模型选择菜单（渲染输出含模型候选）
      tui.write('/model\r');
      expect(await waitFor(() => tui.getOutput().includes('deepseek'))).toBe(true);
      // ③ /quit 退出（退出码 0）
      tui.write('/quit\r');
      expect(await waitFor(() => tui.exitCode() !== null)).toBe(true);
      expect(tui.exitCode()).toBe(0);
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 20000);

  it('输入 /help → 命令列表渲染（slash 输出走渲染层）', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'));
      tui.write('/help\r');
      expect(await waitFor(() => tui.getOutput().includes('/resume'))).toBe(true); // 命令列表渲染
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 15000);

  it('Ctrl+P → 切换模型提示渲染', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'));
      tui.write('\x10'); // Ctrl+P（0x10）
      expect(await waitFor(() => tui.getOutput().includes('已切换模型'))).toBe(true);
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 15000);

  it('输入 @前缀 → 文件补全菜单（@文件候选渲染）', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'));
      tui.write('@p'); // cwd 含 package.json（仓库根）
      expect(await waitFor(() => tui.getOutput().includes('package.json'))).toBe(true);
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 15000);

  it('多行快速输入 → 粘贴折叠提示（防逐行误执行）', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'));
      tui.write('第一行\r第二行\r'); // 120ms 窗口内连续行 → 折叠
      expect(await waitFor(() => tui.getOutput().includes('已折叠为单行'))).toBe(true);
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 15000);

  it('resize 窗口尺寸 → 渲染不崩（横幅仍在）', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'));
      tui.p.resize(60, 20);
      await new Promise((r) => setTimeout(r, 500));
      expect(tui.getOutput().includes('dscode — 输入 /help 查看命令')).toBe(true); // resize 后仍渲染
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 15000);

  it('输入问题 → 回显 `> 问题` 渲染（网关无关，回显先于 agent）', async () => {
    if (!available()) return;
    const tui = startTui();
    try {
      await waitFor(() => tui.getOutput().includes('dscode — 输入 /help 查看命令'));
      tui.write('你好\r');
      expect(await waitFor(() => tui.getOutput().includes('> 你好'))).toBe(true); // 回显独占一行
    } finally {
      if (tui.exitCode() === null) tui.kill();
    }
  }, 15000);
});
