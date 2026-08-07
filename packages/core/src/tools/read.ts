/**
 * read 工具（原理-file-tools.md §2、架构文档 §4.2.5）。
 * - offset/limit 按行分片读，防超大文件撑爆 context
 * - 图片路径 → 作为 image 附件回传（元数据标记，不裸读字节）
 * - 目录 → 报错并提示用 ls/glob；二进制/非 UTF-8 → 不裸读
 * - 路径逃逸拒绝（resolveWithin）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { tryResolve } from '../util/path.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
/** 无 limit 时的行数上限（防整文件灌爆 context） */
const DEFAULT_MAX_LINES = 10_000;

export const readParams = Type.Object({
  path: Type.String({ description: '文件路径（相对 cwd 或绝对路径）' }),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: '起始行号（0 基）' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: '最多读取行数' })),
});

export type ReadParams = Static<typeof readParams>;

export const readTool: Tool<ReadParams> = {
  name: 'read',
  description: '读取文件内容。支持 offset/limit 按行分片；图片以 image 附件形式返回。读目录请用 ls/glob。',
  parameters: readParams,

  async execute(_toolCallId, params, ctx) {
    const resolved = tryResolve(ctx.cwd, params.path);
    if ('error' in resolved) {
      return { output: resolved.error, isError: true };
    }
    const filePath = resolved.path;
    const st = await fs.stat(filePath).catch(() => null);
    if (!st) {
      return { output: `文件不存在: ${params.path}`, isError: true };
    }
    if (st.isDirectory()) {
      return { output: `${params.path} 是目录，请用 ls 或 glob 列出内容`, isError: true };
    }

    // 图片：作为 image 附件回传（多模态模型可见；不把字节塞进文本）
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      return {
        output: `[image attachment: ${params.path}]`,
        metadata: { type: 'image', path: filePath },
      };
    }

    // 二进制嗅探：前 8000 字节含 NUL → 判二进制
    const buffer = await fs.readFile(filePath);
    if (buffer.subarray(0, 8000).includes(0)) {
      return { output: `${params.path} 是二进制文件，不读取原始内容`, isError: true };
    }

    const text = buffer.toString('utf8');
    const lines = text.split('\n');
    const offset = params.offset ?? 0;
    const limit = params.limit ?? DEFAULT_MAX_LINES;
    const slice = lines.slice(offset, offset + limit);
    const truncated = offset + slice.length < lines.length;
    const numbered = slice.map((l, i) => `${offset + i + 1}\t${l}`).join('\n');

    return {
      output: numbered || '(空文件)',
      metadata: {
        totalLines: lines.length,
        offset,
        truncated,
        type: 'text',
      },
    };
  },
};
