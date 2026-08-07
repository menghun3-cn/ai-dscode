/**
 * ls 工具（架构文档 §4.2.5、todos M1-S3 [P1]）。
 * 列目录条目（目录带 / 后缀，先目录后文件）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { resolveWithin } from '../util/path.js';

export const lsParams = Type.Object({
  path: Type.Optional(Type.String({ description: '目录路径（默认 cwd）' })),
});

export type LsParams = Static<typeof lsParams>;

export const lsTool: Tool<LsParams> = {
  name: 'ls',
  description: '列出目录条目（目录带 / 后缀）。',
  parameters: lsParams,

  async execute(_toolCallId, params, ctx) {
    const dir = params.path ? resolveWithin(ctx.cwd, params.path) : ctx.cwd;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) {
      return { output: `目录不存在: ${params.path ?? '.'}`, isError: true };
    }
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const lines = sorted.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return { output: lines.length > 0 ? lines.join('\n') : '(空目录)', metadata: { dir } };
  },
};
