/**
 * glob 工具（架构文档 §4.2.5、todos M1-S3）。
 * 基于 fast-glob，默认尊重 .gitignore（忽略 node_modules 等）。
 */

import fg from 'fast-glob';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';

export const globParams = Type.Object({
  pattern: Type.String({ description: 'glob 模式，如 **/*.ts' }),
  path: Type.Optional(Type.String({ description: '搜索根目录（默认 cwd）' })),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, default: 100, description: '最大返回条数（防海量命中撑爆 context）' })),
});

export type GlobParams = Static<typeof globParams>;

export const globTool: Tool<GlobParams> = {
  name: 'glob',
  description: '按 glob 模式匹配文件路径（尊重 .gitignore）。返回相对路径列表。',
  parameters: globParams,

  async execute(_toolCallId, params, ctx) {
    const cwd = params.path ? resolveSafe(ctx, params.path) : ctx.cwd;
    const max = params.maxResults ?? 100;
    const matches = await fg(params.pattern, { cwd, onlyFiles: true, unique: true, absolute: false });
    const slice = matches.slice(0, max);
    const truncated = matches.length > max;
    return {
      output: slice.length > 0 ? slice.join('\n') : '(无匹配)',
      metadata: { total: matches.length, truncated, cwd },
    };
  },
};

import { resolveWithin } from '../util/path.js';

function resolveSafe(ctx: { cwd: string }, p: string): string {
  return resolveWithin(ctx.cwd, p);
}
