/**
 * grep 工具（架构文档 §4.2.5、需求 FR-3.6、todos M1-S3）。
 * 优先 ripgrep（rg），fallback 到内置正则递归搜索。
 * 返回命中行 + 行号 + 内容（不返回整文件），maxResults 截断防撑爆 context。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { tryResolve } from '../util/path.js';

const execFileAsync = promisify(execFile);

export const grepParams = Type.Object({
  pattern: Type.String({ description: '正则表达式' }),
  path: Type.Optional(Type.String({ description: '搜索目录（默认 cwd）' })),
  caseSensitive: Type.Optional(Type.Boolean({ default: false })),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, default: 100, description: '最大命中数（防海量命中撑爆 context）' })),
});

export type GrepParams = Static<typeof grepParams>;

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

/** 尝试 ripgrep；返回 null 表示 rg 不可用（fallback 到内置搜索） */
async function tryRipgrep(params: GrepParams, cwd: string, max: number): Promise<GrepMatch[] | null> {
  try {
    const args = [
      '--line-number',
      '--no-heading',
      '--max-count', '1',
      params.caseSensitive ? '' : '--ignore-case',
      '--max-filesize', '2M',
      '--',
      params.pattern,
      '.',
    ].filter(Boolean);
    const { stdout } = await execFileAsync('rg', args, { cwd, maxBuffer: 1024 * 1024, timeout: 15_000 });
    return parseRgOutput(stdout, max);
  } catch {
    return null; // rg 不存在或执行失败 → 内置 fallback
  }
}

function parseRgOutput(stdout: string, max: number): GrepMatch[] {
  const out: GrepMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (out.length >= max) break;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const file = line.slice(0, idx);
    const rest = line.slice(idx + 1);
    const lineIdx = rest.indexOf(':');
    if (lineIdx === -1) continue;
    const lineNo = Number(rest.slice(0, lineIdx));
    out.push({ file, line: lineNo, text: rest.slice(lineIdx + 1) });
  }
  return out;
}

/** 内置 fallback：递归遍历目录 + 正则匹配（无 rg 依赖） */
export async function grepFallback(pattern: RegExp, cwd: string, max: number): Promise<GrepMatch[]> {
  const out: GrepMatch[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage']);
  async function walk(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const st = await fs.stat(full);
          if (st.size > 2 * 1024 * 1024) continue; // >2M 跳过
          const text = await fs.readFile(full, 'utf8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (out.length >= max) break;
            if (pattern.test(lines[i]!)) {
              // 统一用正斜杠，跨平台输出一致（Windows 反斜杠 → /）
              const rel = path.relative(cwd, full).replace(/\\/g, '/');
              out.push({ file: rel, line: i + 1, text: lines[i]!.slice(0, 500) });
            }
          }
        } catch {
          // 二进制/权限错误跳过
        }
      }
    }
  }
  await walk(cwd);
  return out;
}

export const grepTool: Tool<GrepParams> = {
  name: 'grep',
  description: '在文件内容中搜索正则表达式，返回 文件:行号:命中行。优先 ripgrep，无 rg 时用内置搜索。',
  parameters: grepParams,

  async execute(_toolCallId, params, ctx) {
    const resolved = params.path ? tryResolve(ctx.cwd, params.path) : { path: ctx.cwd };
    if ('error' in resolved) {
      return { output: resolved.error, isError: true };
    }
    const cwd = resolved.path;
    const max = params.maxResults ?? 100;
    const flags = params.caseSensitive ? '' : 'i';

    // 先试 rg（快速、尊重 .gitignore）
    const rg = await tryRipgrep(params, cwd, max);
    const matches = rg ?? (await grepFallback(new RegExp(params.pattern, flags), cwd, max));

    const truncated = matches.length >= max;
    return {
      output: matches.length > 0 ? matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n') : '(无匹配)',
      metadata: { total: matches.length, truncated, engine: rg ? 'ripgrep' : 'fallback' },
    };
  },
};
