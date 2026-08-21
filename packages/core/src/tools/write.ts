/**
 * write 工具（原理-file-tools.md §3、架构文档 §4.2.5、需求 FR-3.2）。
 * - 创建/覆盖文件，自动建父目录
 * - 路径逃逸拒绝（resolveWithin）
 * - 只写文本；写 .env / secrets 等敏感路径的拦截由权限 deny 负责（M5，见 原理-permission.md）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { tryResolve } from '../util/path.js';
import { unifiedDiff } from '../util/diff.js';

export const writeParams = Type.Object({
  path: Type.String({ description: '目标文件路径（相对 cwd 或绝对路径）' }),
  content: Type.String({ description: '文件内容' }),
});

export type WriteParams = Static<typeof writeParams>;

export const writeTool: Tool<WriteParams> = {
  name: 'write',
  description: '创建或覆盖写入文件，自动创建父目录。注意：会整体覆盖已存在文件，改动请用 edit。',
  parameters: writeParams,

  async execute(_toolCallId, params, ctx) {
    const resolved = tryResolve(ctx.cwd, params.path);
    if ('error' in resolved) {
      return { output: resolved.error, isError: true };
    }
    const filePath = resolved.path;
    // 覆盖前快照：已存在文件才需要 diff 对账（原理-file-tools.md §6）
    const before = await fs.readFile(filePath, 'utf8').catch(() => null);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content, 'utf8');
    const bytes = Buffer.byteLength(params.content, 'utf8');
    const isNew = before === null;
    const diff = isNew ? { text: '', stats: { added: 0, removed: 0 } } : unifiedDiff(before!, params.content, { label: params.path });
    const statText = isNew ? '（新建）' : diff.stats.added + diff.stats.removed > 0 ? `（+${diff.stats.added} -${diff.stats.removed}）` : '';
    return {
      output: `已写入 ${params.path}（${bytes} 字节）${statText}`,
      metadata: { bytes, path: filePath, isNew, diff: diff.text, diffStats: diff.stats },
    };
  },
};
